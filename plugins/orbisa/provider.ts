import type { BbPluginApi, MachineExecutor } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createHash } from "node:crypto";
import { orbisaHostContract, orbisaRequest } from "./contract.ts";
import { createOrbisaPolicy } from "./policy.ts";
import { prepareProfile } from "./profile.ts";
import { defineSettings } from "./settings.ts";

const inputsSchema = z.object({
  runtimeHostId: z.string().min(1),
  backend: z.enum(["incus", "orbstack"]),
  image: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*$/)
    .optional(),
});
const resourceSchema = inputsSchema.extend({
  image: z.string(),
  owner: z.string(),
  key: z.string(),
  id: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
});
type Resource = z.infer<typeof resourceSchema>;
const responseSchema = z.object({
  version: z.literal(1),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export function registerOrbisaProvider(
  bb: BbPluginApi,
  options: {
    prepareCredentials?: (executor: MachineExecutor, signal: AbortSignal) => Promise<void>;
  } = {},
) {
  const settings = defineSettings(bb);
  const owner =
    "bb-" + createHash("sha256").update(bb.server.experimental_dataDir).digest("hex").slice(0, 20);
  const client = bb.hosts.experimental_client({ contract: orbisaHostContract });
  const owned = (value: unknown) => {
    const r = resourceSchema.parse(value);
    if (r.owner !== owner) throw new Error("Foreign Orbisa owner.");
    return r;
  };
  const call = async (
    r: Resource,
    action: z.infer<typeof orbisaRequest>["action"],
    signal: AbortSignal,
    extra: Partial<z.infer<typeof orbisaRequest>> = {},
  ) => {
    const request = orbisaRequest.parse({
      ...extra,
      action,
      owner: r.owner,
      key: r.key,
      ...(r.id ? { id: r.id } : {}),
      image: r.image,
      backend: r.backend,
    });
    const reply = await client.call("run", request, {
      hostId: r.runtimeHostId,
      signal,
      timeoutMs: Math.min(request.timeoutMs + 10_000, 1_800_000),
    });
    return reply;
  };
  const lifecycle = async (
    r: Resource,
    action: "create" | "start" | "stop" | "remove",
    signal: AbortSignal,
  ) => {
    const result = await call(r, action, signal);
    const response = responseSchema.parse(JSON.parse(result.stdout));
    if (result.exitCode !== 0 || !response.ok)
      throw new Error(
        `Orbisa ${response.error?.code ?? "failed"}: ${response.error?.message ?? "command failed"}`,
      );
    return response.data;
  };
  const executor = (r: Resource): MachineExecutor => ({
    exec: async ({ command, stdin, timeoutMs, signal, onOutput }) => {
      const result = await call(r, "exec", signal, {
        command,
        stdin,
        timeoutMs: Math.min(timeoutMs, 1_700_000),
      });
      if (result.stdout) onOutput(result.stdout);
      if (result.stderr) onOutput(result.stderr);
      return { exitCode: result.exitCode };
    },
  });
  const prepare = async (
    r: Resource,
    signal: AbortSignal,
    report: { step(text: string): void },
  ) => {
    await lifecycle(r, "start", signal);
    if (options.prepareCredentials) {
      await options.prepareCredentials(executor(r), signal);
      return;
    }
    await prepareProfile(
      bb.server.experimental_dataDir,
      await settings.get(),
      async (command, stdin = "") => {
        const result = await call(r, "exec", signal, { command, stdin });
        if (result.exitCode !== 0) throw new Error("Orbisa guest preparation failed.");
        return result.stdout;
      },
      signal,
      report.step,
    );
  };
  bb.experimental_machines.register({
    id: "orbisa-machine",
    displayName: "Orbisa environment",
    icon: "Server",
    description:
      "Dedicated environment on Linux or macOS. Settling stops it and deletes its files after 10 minutes.",
    ephemeral: false,
    inputs: inputsSchema,
    async create(context) {
      const inputs = inputsSchema.parse(context.inputs);
      let r: Resource = {
        ...inputs,
        image:
          inputs.image ?? (inputs.backend === "incus" ? "orbisa-tooling-v2" : "orbisa-tooling-v1"),
        owner,
        key: context.key,
      };
      // Save the transport destination before any remote allocation so cleanup
      // by key works even when the first checkpoint response is interrupted.
      const prior = await bb.storage.kv.get(`orbisa-intent/${context.key}`);
      if (prior) {
        const saved = owned(prior);
        if (
          saved.runtimeHostId !== r.runtimeHostId ||
          saved.image !== r.image ||
          saved.backend !== r.backend
        )
          throw new Error("Allocation inputs changed.");
        r = saved;
      }
      await bb.storage.kv.set(`orbisa-intent/${context.key}`, r);
      await context.checkpoint(r);
      context.report.step("Allocating an Orbisa environment on the runtime host");
      const allocation = z
        .object({ id: z.string(), name: z.string() })
        .parse(await lifecycle(r, "create", context.signal));
      r = { ...r, id: allocation.id };
      await bb.storage.kv.set(`orbisa-intent/${context.key}`, r);
      await context.checkpoint(r);
      await prepare(r, context.signal, context.report);
      await bb.experimental_machines.bootstrap({
        key: r.key,
        executor: executor(r),
        report: context.report,
        signal: context.signal,
      });
      return { status: "created", name: allocation.name, resource: r };
    },
    async reconcileCleanup(context) {
      const value = await bb.storage.kv.get(`orbisa-intent/${context.key}`);
      if (value) await lifecycle(owned(value), "remove", context.signal);
      return { status: "removed" };
    },
    async suspend(context) {
      const r = owned(context.resource);
      await context.checkpoint(r);
      await lifecycle(r, "stop", context.signal);
      return { resource: r };
    },
    async resume(context) {
      const r = owned(context.resource);
      await prepare(r, context.signal, context.report);
      await context.checkpoint(r);
      await bb.experimental_machines.bootstrap({
        key: r.key,
        executor: executor(r),
        report: context.report,
        signal: context.signal,
      });
      return { resource: r };
    },
    async remove(context) {
      await lifecycle(owned(context.resource), "remove", context.signal);
      return { status: "removed" };
    },
  });
  bb.experimental_environments.register({
    id: "orbisa-machine",
    displayName: "Orbisa environment",
    icon: "Server",
    description: "A private filesystem, processes, network and project checkout.",
    machineProviderId: "orbisa-machine",
    environmentProviderId: "project-checkout",
  });
  return createOrbisaPolicy(bb, owned);
}
