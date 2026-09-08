import { rpcContract } from "./contract.ts";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { WakeJobs, slots, validateSlot, type Slot } from "./wake.ts";

const exec = promisify(execFile);
export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    daemonService: {
      type: "string",
      label: "VM daemon service",
      description: "The systemd user service enrolled with this bb instance.",
      default: "bb-host-daemon-bb-plugins-getbb-app.service",
      experimental_schema: z.string().regex(/^bb-host-daemon-[a-z0-9-]+\.service$/),
    },
  });
  const controller = new AbortController();
  const bindings = () => bb.storage.kv.get<Record<string, Slot>>("bindings");
  const jobs = new WakeJobs(async (hostId, slot) => {
    try {
      // Existing SSH ProxyCommand starts Orbisa and refreshes its volatile credentials.
      await exec(
        "ssh",
        [
          "-T",
          "-o",
          "BatchMode=yes",
          slot,
          `systemctl --user start ${(await settings.get()).daemonService}`,
        ],
        {
          signal: controller.signal,
          timeout: 120_000,
          maxBuffer: 64 * 1024,
        },
      );
      const deadline = Date.now() + 120_000;
      while ((await bb.sdk.hosts.get({ hostId })).status !== "connected") {
        if (Date.now() >= deadline) throw new Error("Daemon connection timed out");
        await delay(1000, undefined, { signal: controller.signal });
      }
      await bb.experimental_hooks.recheck("message.dispatch");
    } catch (error) {
      if (!controller.signal.aborted)
        bb.log.warn(`Could not wake ${slot}; retry with bb orbisa wake ${slot}`);
      throw error;
    }
  });
  bb.rpc.register(rpcContract, {
    async list() {
      const saved = (await bindings()) ?? {};
      const hosts = await bb.sdk.hosts.list();
      return slots.map((slot) => {
        const hostId = Object.keys(saved).find((id) => saved[id] === slot);
        const host = hosts.find((item) => item.id === hostId);
        const status = !hostId
          ? "unbound"
          : host?.status === "connected"
            ? "connected"
            : jobs.running(hostId)
              ? "starting"
              : jobs.failed(hostId)
                ? "failed"
                : "offline";
        return { slot, status };
      });
    },
    async wake({ slot }) {
      const saved = (await bindings()) ?? {};
      const hostId = Object.keys(saved).find((id) => saved[id] === slot);
      if (!hostId) throw new Error("Bind the enrolled machine first");
      void jobs.start(hostId, slot, true);
      return null;
    },
  });
  bb.experimental_hooks.on("message.dispatch", async ({ host }) => {
    if (!host) return { action: "proceed" };
    const slot = (await bindings())?.[host.id];
    if (!slot) return { action: "proceed" };
    if (host.status === "connected") {
      jobs.clear(host.id);
      return { action: "proceed" };
    }
    void jobs.start(host.id, slot);
    return {
      action: "wait",
      reason: jobs.failed(host.id)
        ? `${slot} did not connect. Retry with bb orbisa wake ${slot}.`
        : `Starting ${slot} and waiting for its bb daemon…`,
    };
  });
  bb.onDispose(async () => {
    controller.abort();
    await jobs.settle();
  });
  bb.cli.register({
    name: "orbisa",
    summary: "Wake isolated Orbisa execution machines for this bb server",
    commands: [
      {
        name: "status",
        summary: "Show bindings and connection state without waking VMs",
        usage: "bb orbisa status",
      },
      {
        name: "bind",
        summary: "Bind a VM slot to an enrolled machine",
        usage: "bb orbisa bind <slot> <host-id>",
      },
      {
        name: "wake",
        summary: "Wake a VM and retry waiting messages",
        usage: "bb orbisa wake <slot>",
      },
    ],
    async run(argv) {
      try {
        const saved = (await bindings()) ?? {};
        if (argv[0] === "status" && argv.length === 1) {
          const hosts = await bb.sdk.hosts.list();
          return {
            exitCode: 0,
            stdout: JSON.stringify(
              slots.map((slot) => {
                const hostId = Object.keys(saved).find((id) => saved[id] === slot);
                return {
                  slot,
                  hostId: hostId ?? null,
                  status: hosts.find((host) => host.id === hostId)?.status ?? "unbound",
                };
              }),
              null,
              2,
            ),
          };
        }
        if (argv[0] === "bind" && argv.length === 3) {
          const slot = validateSlot(argv[1]!);
          const host = await bb.sdk.hosts.get({ hostId: argv[2]! });
          if (host.name !== slot) throw new Error("Machine name must match the Orbisa slot");
          for (const id of Object.keys(saved)) if (saved[id] === slot) delete saved[id];
          saved[host.id] = slot;
          await bb.storage.kv.set("bindings", saved);
          return { exitCode: 0, stdout: `Bound ${slot} to ${host.id}` };
        }
        if (argv[0] === "wake" && argv.length === 2) {
          const slot = validateSlot(argv[1]!);
          const hostId = Object.keys(saved).find((id) => saved[id] === slot);
          if (!hostId) throw new Error("Bind the enrolled machine first");
          await jobs.start(hostId, slot, true);
          if (jobs.failed(hostId))
            throw new Error(`Could not wake ${slot}; check orbisa start and the VM daemon service`);
          return { exitCode: 0, stdout: `${slot} connected` };
        }
        throw new Error("Usage: bb orbisa status | bind <slot> <host-id> | wake <slot>");
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
