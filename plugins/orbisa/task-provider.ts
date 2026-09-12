import { startupStep, retryConnection } from "./task-startup.ts";
import { reconnectDaemon } from "./task-resume.ts";
import { dirname, join } from "node:path";
import { registerTaskMaintenance } from "./task-maintenance.ts";
import { timed } from "./task-timing.ts";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerTaskCheckout, CHECKOUT_PROVIDER } from "./task-checkout.ts";
import { createTaskPolicy } from "./task-policy.ts";
import {
  createTaskDriver,
  ownedResource,
  taskOwner,
  taskResource,
  TASK_PROVIDER,
  type TaskDriver,
} from "./task-vms.ts";

export interface TaskSettings {
  taskTemplate: string;
  taskIdleMinutes: number;
}
export function registerTaskProvider(
  bb: BbPluginApi,
  settings: () => Promise<TaskSettings>,
  driver?: TaskDriver,
  now = Date.now,
) {
  const owner = taskOwner(bb.server.experimental_dataDir);
  const receipts = {
    cacheDir: join(dirname(bb.storage.database().name), "skills-cache"),
    get: (name: string) => bb.storage.kv.get(`task-base/${name}`),
    lastUsed: (name: string) => bb.storage.kv.get(`task-base-used/${name}`),
    touch: (name: string, at: number) => bb.storage.kv.set(`task-base-used/${name}`, at),
    set: (name: string, id: string) => bb.storage.kv.set(`task-base/${name}`, id),
    select: (name: string) => bb.storage.kv.set("task-base-current", name),
  };
  const machineDriver =
    driver ??
    createTaskDriver(bb.server.experimental_dataDir, () => bb.server.loopbackBaseUrl, receipts);
  registerTaskMaintenance(bb, owner, receipts);

  const policy = createTaskPolicy(bb, owner, async () => (await settings()).taskIdleMinutes, now);
  registerTaskCheckout(bb, owner);
  bb.experimental_machines.register({
    id: TASK_PROVIDER,
    displayName: "Orbisa task VM",
    description:
      "An isolated task VM. Settling its last thread starts a 10-minute deletion countdown.",
    icon: "Server",
    // BB's ephemeral cleanup is immediate. Our durable policy requests normal
    // provider removal only once the ten-minute undo window has elapsed.
    ephemeral: false,
    async availability() {
      return (await machineDriver.available((await settings()).taskTemplate))
        ? { status: "available" }
        : {
            status: "setup-required",
            message:
              "Orbisa task VMs require OrbStack on this server and an isolated cursor-base template.",
          };
    },
    async create(context) {
      let resource = taskResource(owner, context.key);
      // Persist the allocation identity BEFORE clone, allowing cancellation and
      // crash recovery to clean up even if clone completes after interruption.
      await context.checkpoint(resource);
      context.report.step("Creating isolated Orbisa task VM");
      const report = (text: string) => context.report.step(text);
      const timings: string[] = [];
      const timing = (text: string) => {
        timings.push(text);
        context.report.log(`${text}\n`);
      };
      resource = await timed(timing, "Base preparation and VM clone", async () =>
        machineDriver.allocate(resource, (await settings()).taskTemplate, context.signal, report),
      );
      await context.checkpoint(resource);
      await timed(timing, "VM start and credential setup", () =>
        machineDriver.prepare(resource, context.signal, report),
      );
      const { hostId } = await timed(timing, "Machine enrollment and connection", () =>
        startupStep(
          "host-unavailable",
          "Machine enrollment did not connect. Check BB Connect and the host daemon, then retry provisioning.",
          context.signal,
          () =>
            retryConnection(
              () =>
                bb.experimental_machines.bootstrap({
                  key: resource.key,
                  executor: machineDriver.executor(resource),
                  report: context.report,
                  signal: context.signal,
                }),
              context.signal,
              report,
            ),
        ),
      );
      await bb.storage.kv.set(`task-resource/${hostId}`, resource);
      // Bootstrap may finish its progress stream before our final measurement.
      // Replay the bounded summary when workspace provisioning takes over.
      await bb.storage.kv.set(`task-timings/${hostId}`, timings);
      await policy.bump(hostId);
      return { status: "created", name: resource.name, resource };
    },
    async reconcileCleanup(context) {
      await machineDriver.remove(taskResource(owner, context.key), context.signal);
      return { status: "removed" };
    },
    async suspend(context) {
      const resource = ownedResource(owner, context.resource);
      await context.checkpoint(resource);
      await machineDriver.stop(resource, context.signal);
      return { resource };
    },
    async resume(context) {
      const resource = ownedResource(owner, context.resource);
      const removing =
        (await bb.sdk.hosts.get({ hostId: context.hostId })).lifecycle.phase === "removing";
      await machineDriver.prepare(
        resource,
        context.signal,
        (text) => context.report.step(text),
        removing,
      );
      await context.checkpoint(resource);
      const connected =
        machineDriver.startDaemon &&
        (await reconnectDaemon({
          signal: context.signal,
          start: () => machineDriver.startDaemon!(resource, context.hostId, context.signal),
          connected: async () =>
            (await bb.sdk.hosts.get({ hostId: context.hostId })).status === "connected",
        }));
      if (connected) context.report.log("Resumed existing BB daemon without bootstrap.\n");
      else {
        context.report.step("Restoring BB daemon through bootstrap");
        await startupStep(
          "host-unavailable",
          "Machine enrollment did not reconnect. Check BB Connect and the host daemon, then resume again.",
          context.signal,
          () =>
            retryConnection(
              () =>
                bb.experimental_machines.bootstrap({
                  key: resource.key,
                  executor: machineDriver.executor(resource),
                  report: context.report,
                  signal: context.signal,
                }),
              context.signal,
              (text) => context.report.step(text),
            ),
        );
      }
      // Removal may resume while our sweep awaits hosts.delete. Do not acquire
      // the policy lock in that path or extend activity on a retiring machine.
      if (!removing) await policy.bump(context.hostId);
      return { resource };
    },
    async remove(context) {
      await machineDriver.remove(ownedResource(owner, context.resource), context.signal);
      return { status: "removed" };
    },
  });
  bb.experimental_environments.register({
    id: TASK_PROVIDER,
    displayName: "Orbisa task VM",
    description: "Create a dedicated Orbisa VM and project checkout for this task.",
    icon: "Server",
    machineProviderId: TASK_PROVIDER,
    environmentProviderId: CHECKOUT_PROVIDER,
  });
  return policy;
}
