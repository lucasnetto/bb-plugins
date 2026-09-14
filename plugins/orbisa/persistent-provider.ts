import type { BbPluginApi, PluginMachineProviderDeclaration } from "@get-bb/plugin-sdk";
import { ConfigProvider, Effect, ManagedRuntime, Semaphore } from "effect";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { createTaskDriver, type TaskDriver, type TaskResource } from "./task-vms.ts";
import { checked } from "./task-process.ts";
import { foreign, parse, PersistentError } from "./persistent-effects.ts";
import {
  ownedPersistentResource,
  persistentResource,
  persistentSchema,
  persistentInputs,
  profileSlots,
  PERSISTENT_PROVIDER,
  PERSISTENT_TEMPLATE,
  type PersistentResource,
} from "./persistent-resource.ts";
import { seedPersistentCatalog } from "./persistent-catalog.ts";
import { cleanPersistentProcesses } from "./persistent-process-cleanup.ts";
import { createPersistentRuntimeCleanup } from "./persistent-runtime-cleanup.ts";
import { createPersistentPolicy } from "./persistent-policy.ts";

type Definition = PluginMachineProviderDeclaration<ReturnType<typeof persistentInputs>>;

const fail = (message: string) => Effect.fail(new PersistentError({ message }));

export interface PersistentSettings {
  persistentIdleMinutes: number;
  persistentRuntimeIdleMinutes?: number;
}

export interface PersistentAdapters {
  driver: TaskDriver;
  exists: (name: string, signal: AbortSignal) => Promise<boolean>;
  seed: (
    resource: PersistentResource,
    report: (message: string) => void,
  ) => Effect.Effect<void, PersistentError>;
}

export function registerPersistentProvider(
  bb: BbPluginApi,
  settings: () => Promise<PersistentSettings>,
  adapters?: PersistentAdapters,
) {
  const dataDir = bb.server.experimental_dataDir;

  const owned = (value: TaskResource) =>
    ownedPersistentResource(dataDir, persistentSchema.parse(value));

  const native: PersistentAdapters = adapters ?? {
    driver: createTaskDriver(
      dataDir,
      () => bb.server.loopbackBaseUrl,
      {
        get: async (name) =>
          z.string().safeParse(await bb.storage.kv.get(`persistent-base/${name}`)).data,
        set: (name, id) => bb.storage.kv.set(`persistent-base/${name}`, id),
      },
      { validateResource: owned, sdkOnly: true },
    ),
    exists: async (name, signal) =>
      z
        .array(z.object({ name: z.string() }))
        .parse(JSON.parse(await checked(["orbctl", "list", "--format", "json"], { signal })))
        .some((vm) => vm.name === name),
    seed: (resource, report) =>
      basename(dataDir) === ".bb-work"
        ? seedPersistentCatalog(
            resource,
            join(dirname(bb.storage.database().name), "git-cache"),
            report,
          )
        : Effect.void,
  };

  // Preserve explicit empty values so validation rejects them rather than defaulting.
  const runtime = ManagedRuntime.make(
    ConfigProvider.layer(ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
  );

  const lock = Semaphore.makeUnsafe(1);
  const policy = createPersistentPolicy(bb, async () => (await settings()).persistentIdleMinutes);

  const cleanup = createPersistentRuntimeCleanup(
    bb,
    async () => (await settings()).persistentRuntimeIdleMinutes ?? 15,
    Date.now,
    async (hostId, paths, threadIds, signal) => {
      const host = await bb.sdk.hosts.get({ hostId, signal });
      const slot = profileSlots(dataDir).find((slot) => host.name.endsWith(`-${slot}`));

      if (!slot) throw new Error("Unknown persistent slot.");

      const resource = owned(
        persistentSchema.parse(await bb.storage.kv.get(`persistent-slot/${slot}`)),
      );

      if (host.machineProviderId !== PERSISTENT_PROVIDER || host.name !== resource.name)
        throw new Error("Persistent machine ownership mismatch.");
      await cleanPersistentProcesses(resource, hostId, paths, threadIds, signal);
    },
  );

  bb.onDispose(() => runtime.dispose());
  const slotKey = (slot: string) => `persistent-slot/${slot}`;
  const launchKey = (key: string) => `persistent-launch/${key}`;

  const read = (key: string) =>
    foreign("Could not read persistent VM ownership.", async () =>
      persistentSchema.nullish().parse(await bb.storage.kv.get(key)),
    );

  const save = (resource: PersistentResource) =>
    foreign("Could not save persistent VM ownership.", () =>
      bb.storage.kv.set(slotKey(resource.slot), resource),
    );

  const assertClaim = Effect.fn("Persistent.assertClaim")(function* (value: PersistentResource) {
    const resource = yield* parse(() => owned(value));
    const saved = yield* read(slotKey(resource.slot));

    if (!saved || saved.key !== resource.key)
      return yield* fail("This VM slot belongs to another machine launch.");
    const current = yield* parse(() => owned(saved));

    if (resource.vmId && current.vmId && resource.vmId !== current.vmId)
      return yield* fail("Persistent VM identity changed.");

    return current;
  });

  const create = Effect.fn("Persistent.create")(function* (
    context: Parameters<Definition["create"]>[0],
  ) {
    let resource = yield* parse(() =>
      persistentResource(dataDir, context.key, context.inputs.slot),
    );

    const saved = yield* read(slotKey(resource.slot));

    if (saved) {
      if (saved.key !== context.key)
        return yield* fail("This slot already has a BB machine. Resume that machine instead.");
      resource = yield* parse(() => owned(saved));
    } else {
      if (
        yield* foreign("Could not inspect OrbStack machines.", (signal) =>
          native.exists(resource.name, signal),
        )
      )
        return yield* fail("A VM already uses this name without a matching BB ownership record.");
      // Reserve before allocation; a different launch cannot claim this stable name.
      yield* foreign("Could not record allocation intent.", () =>
        bb.storage.kv.set(launchKey(context.key), resource),
      );
      yield* save(resource);
    }

    yield* foreign("Could not record machine launch.", () =>
      bb.storage.kv.set(launchKey(context.key), resource),
    );
    yield* foreign("Could not checkpoint machine ownership.", () => context.checkpoint(resource));
    context.report.step(`Creating ${resource.name} from the BB-only base`);

    const allocated = yield* foreign("Could not create the persistent VM.", (signal) =>
      native.driver.allocate(resource, PERSISTENT_TEMPLATE, signal, (message) =>
        context.report.step(message),
      ),
    );

    resource = yield* parse(() => owned(allocated));
    yield* save(resource);
    yield* foreign("Could not checkpoint VM identity.", () => context.checkpoint(resource));
    yield* foreign("Could not prepare the VM's account credentials.", (signal) =>
      native.driver.prepare(resource, signal, (message) => context.report.step(message)),
    );
    yield* native.seed(resource, (message) => context.report.step(message));

    const { hostId } = yield* foreign("Could not enroll the VM with BB.", (signal) =>
      bb.experimental_machines.bootstrap({
        key: context.key,
        executor: native.driver.executor(resource),
        report: context.report,
        signal,
      }),
    );

    yield* foreign("Could not record initial activity.", () =>
      bb.storage.kv.set(`persistent-activity/${hostId}`, Date.now()),
    );

    return { status: "created" as const, name: resource.name, resource };
  });

  const remove = Effect.fn("Persistent.remove")(function* (value: PersistentResource) {
    const requested = yield* parse(() => owned(value));
    const saved = yield* read(slotKey(requested.slot));

    // Cleanup is replayable after the VM and its ownership row have been removed.
    if (!saved) return { status: "removed" as const };
    const resource = yield* assertClaim(requested);
    yield* foreign("Could not remove the persistent VM.", (signal) =>
      native.driver.remove(resource, signal),
    );
    yield* foreign("Could not release the VM slot.", () =>
      bb.storage.kv.delete(slotKey(resource.slot)),
    );
    yield* foreign("Could not release the VM launch.", () =>
      bb.storage.kv.delete(launchKey(resource.key)),
    );

    return { status: "removed" as const };
  });

  const run = <A>(effect: Effect.Effect<A, PersistentError>, signal: AbortSignal) =>
    runtime.runPromise(lock.withPermits(1)(effect), { signal });

  bb.experimental_machines.register({
    id: PERSISTENT_PROVIDER,
    displayName: "Persistent Orbisa",
    description: "A persistent BB-only VM with Codex, Cursor SDK support, and automatic resume.",
    icon: "Server",
    ephemeral: false,
    inputs: persistentInputs(dataDir),
    async availability() {
      return (await native.driver.available(PERSISTENT_TEMPLATE))
        ? { status: "available" }
        : {
            status: "setup-required",
            message: "Build the isolated 180seg-orbisa-base template on the Mac first.",
          };
    },
    validate({ inputs: value }) {
      return profileSlots(dataDir).includes(value.slot)
        ? { action: "accept" }
        : {
            action: "refuse",
            message: "Work owns 180seg slots 01 and 02; Personal owns ln slot 01.",
          };
    },
    create: (context) => run(create(context), context.signal),
    reconcileCleanup: (context) =>
      run(
        Effect.gen(function* () {
          const resource = yield* read(launchKey(context.key));

          return resource ? yield* remove(resource) : { status: "removed" as const };
        }),
        context.signal,
      ),
    suspend: (context) =>
      run(
        Effect.gen(function* () {
          const requested = yield* parse(() => persistentSchema.parse(context.resource));
          const resource = yield* assertClaim(requested);
          yield* foreign("Could not checkpoint suspended VM.", () => context.checkpoint(resource));
          yield* foreign("Could not suspend the VM.", (signal) =>
            native.driver.stop(resource, signal),
          );

          return { resource };
        }),
        context.signal,
      ),
    resume: (context) =>
      run(
        Effect.gen(function* () {
          const requested = yield* parse(() => persistentSchema.parse(context.resource));
          const resource = yield* assertClaim(requested);

          const host = yield* foreign("Could not inspect machine lifecycle.", (signal) =>
            bb.sdk.hosts.get({ hostId: context.hostId, signal }),
          );

          const removing = host.lifecycle.phase === "removing";
          yield* foreign("Could not refresh the VM's account credentials.", (signal) =>
            native.driver.prepare(
              resource,
              signal,
              (message) => context.report.step(message),
              removing,
            ),
          );
          yield* foreign("Could not checkpoint resumed VM.", () => context.checkpoint(resource));
          yield* foreign("Could not reconnect the VM to BB.", (signal) =>
            bb.experimental_machines.bootstrap({
              key: resource.key,
              executor: native.driver.executor(resource),
              report: context.report,
              signal,
            }),
          );

          // A policy sweep may be awaiting removal/suspension; don't acquire its lock here.
          if (!removing)
            yield* foreign("Could not record resume time.", () =>
              bb.storage.kv.set(`persistent-activity/${context.hostId}`, Date.now()),
            );

          return { resource };
        }),
        context.signal,
      ),
    remove: (context) =>
      run(
        parse(() => persistentSchema.parse(context.resource)).pipe(Effect.flatMap(remove)),
        context.signal,
      ),
  });
  const sweep = () => runtime.runPromise(policy.sweep());
  bb.background.schedule("persistent-machine-idle", "* * * * *", sweep);
  bb.background.schedule("persistent-runtime-cleanup", "* * * * *", () =>
    runtime.runPromise(cleanup.sweep()),
  );
  bb.events.on("experimental_terminal.input", ({ terminal }) =>
    runtime.runPromise(policy.bump(terminal.hostId)),
  );
  bb.events.on("experimental_thread.events", ({ thread }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        if (!thread.environmentId || !["active", "starting"].includes(thread.status)) return;

        const environment = yield* foreign("Could not inspect thread environment.", (signal) =>
          bb.sdk.environments.get({ environmentId: thread.environmentId!, signal }),
        );

        yield* policy.bump(environment.hostId);
      }),
    ),
  );
}
