import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { PAGE_SIZE, WORKERS_CHANGED, rpcContract } from "./contract";
import { advertisedParameters, configurationSchema, toolSchema, validatePreset } from "./presets";

export default async function plugin(bb: BbPluginApi) {
  let configuration = configurationSchema.parse(
    (await bb.storage.kv.get("presets")) ?? { revision: 0, presets: [] },
  );

  let saveQueue: Promise<unknown> = Promise.resolve();
  bb.agents.configure(() => ({
    tools: [{ name: "bb_worker_thread", parameters: advertisedParameters(configuration.presets) }],
    skills: ["bb-workers"],
  }));
  bb.agents.registerTool({
    name: "bb_worker_thread",
    description:
      "Spawn a hidden child worker in the current project and environment. Returns its thread ID for messaging and waiting.",
    instructions:
      "For delegation, use bb_worker_thread and follow the bb-workers skill. Never create visible threads unless the user explicitly requests them. This applies to workers delegating further too.",
    parameters: toolSchema,
    async execute(input, { threadId }) {
      const parent = await bb.sdk.threads.get({ threadId });
      const execution = await bb.sdk.threads.defaultExecutionOptions({ threadId });

      if (!parent.environmentId || !execution) {
        throw new Error("Worker creation requires a parent environment and execution options.");
      }

      const preset =
        input.preset === undefined
          ? undefined
          : configuration.presets.find((preset) => preset.name === input.preset);

      if (input.preset !== undefined && !preset) {
        throw new Error(
          `Unknown worker preset "${input.preset}". Use a configured preset or omit preset to inherit.`,
        );
      }

      if (preset) await validatePreset(bb, preset, parent.environmentId);

      const resolved = preset
        ? {
            providerId: preset.providerId,
            model: preset.model,
            reasoningLevel: preset.reasoningLevel,
          }
        : {
            providerId: parent.providerId,
            model: execution.model,
            reasoningLevel: execution.reasoningLevel,
          };

      const worker = await bb.sdk.threads.spawn({
        title: input.title,
        prompt: input.prompt,
        ...resolved,
        pluginMetadata: { preset: preset?.name ?? null, ...resolved },
        projectId: parent.projectId,
        parentThreadId: threadId,
        environment: { type: "reuse", environmentId: parent.environmentId },
        permissionMode: execution.permissionMode,
        visibility: "hidden",
        startedOnBehalfOf: { initiator: "agent", senderThreadId: threadId },
      });

      return JSON.stringify({
        threadId: worker.id,
        parentThreadId: threadId,
        visibility: "hidden",
        preset: preset?.name ?? null,
        ...resolved,
      });
    },
  });
  bb.rpc.register(rpcContract, {
    async getConfiguration() {
      return configuration;
    },
    async saveConfiguration(input) {
      const save = saveQueue.then(async () => {
        if (input.revision !== configuration.revision) {
          throw new Error(
            "Worker presets changed in another window. Reload settings before saving.",
          );
        }

        // Allow removing stale presets without requiring their providers online.
        const changed = input.presets.filter(
          (preset) =>
            !configuration.presets.some((old) => JSON.stringify(old) === JSON.stringify(preset)),
        );

        await Promise.all(changed.map((preset) => validatePreset(bb, preset)));
        const next = { revision: configuration.revision + 1, presets: input.presets };
        await bb.storage.kv.set("presets", next);
        configuration = next;

        return next;
      });

      saveQueue = save.catch(() => undefined);

      return save;
    },
    async list({ threadId, offset }) {
      // BB filters archived and unarchived threads separately. Merge both before
      // paging so archiving a worker never removes it from this browser.
      async function readChildren(archived: boolean) {
        const rows = [];

        for (let pageOffset = 0; ; pageOffset += 100) {
          const page = await bb.sdk.threads.list({
            parentThreadId: threadId,
            includeHidden: true,
            archived,
            limit: 100,
            offset: pageOffset,
          });

          rows.push(...page);

          if (page.length < 100) return rows;
        }
      }

      const groups = await Promise.all([readChildren(false), readChildren(true)]);

      const rows = [...new Map(groups.flat().map((row) => [row.id, row])).values()].sort(
        (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
      );

      const workers = await Promise.all(
        rows.slice(offset, offset + PAGE_SIZE).map(async (row) => {
          // A worker may disappear between listing and reading its execution.
          const execution = await bb.sdk.threads
            .defaultExecutionOptions({ threadId: row.id })
            .catch(() => null);

          return {
            id: row.id,
            title: row.title ?? row.titleFallback ?? "Untitled worker",
            providerId: row.providerId,
            model: execution?.model ?? null,
            reasoningLevel: execution?.reasoningLevel ?? null,
            status: row.runtime.displayStatus,
            hasPendingInteraction: row.hasPendingInteraction,
            visibility: row.visibility,
            archived: row.archivedAt !== null,
          };
        }),
      );

      return { workers, hasMore: rows.length > offset + PAGE_SIZE };
    },
  });

  for (const event of [
    "thread.created",
    "thread.active",
    "thread.idle",
    "thread.failed",
    "thread.archived",
    "thread.deleted",
    "interaction.pending",
  ] as const) {
    bb.events.on(event, ({ thread }) => {
      if (thread.parentThreadId) {
        bb.realtime.publish(WORKERS_CHANGED, { threadId: thread.parentThreadId });
      }
    });
  }
}
