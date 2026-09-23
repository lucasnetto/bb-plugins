import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseEnv } from "node:util";
import { createGatewayEvaluator } from "./src/gateway";
import { setTimeout as delay } from "node:timers/promises";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "./src/contract";
import { fixtureEvaluator, fixtureId, fixturePacket, fixtures, packetSchema } from "./src/domain";
import { Store, migrations } from "./src/store";
import { captureHistory, revisionOf } from "./src/history";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    attentionEnabled: { type: "boolean", label: "Enable Jev attention", default: false },
    fixtureMode: {
      type: "boolean",
      label: "Allow explicitly selected offline fixtures",
      default: false,
    },
    captureEnabled: {
      type: "boolean",
      label: "Capture bounded visible messages locally",
      default: false,
    },
    liveEnabled: {
      type: "boolean",
      label: "Allow sending approved project evidence to Gateway (configured retention policy)",
      default: false,
    },
    requireZdr: { type: "boolean", label: "Require zero data retention at Gateway", default: true },
    automaticChecks: {
      type: "boolean",
      label: "Check newly settled threads automatically",
      default: false,
    },
    dailyRequestLimit: {
      type: "number",
      label: "Maximum Gateway attempts per UTC day",
      default: 20,
      experimental_schema: z.number().int().min(1).max(100),
    },
    approvedProject: {
      type: "project",
      label: "Approved project for capture and live evaluation",
    },
    maxEvidenceChars: {
      type: "number",
      label: "Maximum evidence characters per check",
      default: 8000,
      experimental_schema: z.number().int().min(256).max(16000),
    },
    retentionDays: {
      type: "number",
      label: "Local result retention in days",
      default: 7,
      experimental_schema: z.number().int().min(1).max(30),
    },
    gatewayApiKey: {
      type: "string",
      label: "Vercel AI Gateway API key (server only)",
      secret: true,
    },
  });

  let config = await settings.get();
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const store = new Store(db);
  let generation = new AbortController();
  let disposed = false;
  let issue: string | null = null;

  const publish = () => {
    if (!disposed) bb.realtime.publish("attention-changed", null);
  };

  const cancel = () => {
    generation.abort();
    generation = new AbortController();
  };

  settings.onChange((next) => {
    cancel();
    config = next;
    issue = null;
    store.clear();
    publish();
  });
  bb.onDispose(() => {
    disposed = true;
    generation.abort();
  });

  for (const event of [
    "thread.created",
    "thread.active",
    "thread.idle",
    "thread.failed",
    "thread.unarchived",
    "interaction.pending",
    "experimental_thread.events",
  ] as const) {
    bb.events.on(event, (payload) => {
      const { thread } = payload;

      if (!config.attentionEnabled || thread.projectId !== config.approvedProject) return;
      const old = store.subject(thread.id);

      if (old) {
        const [timestamp, status] = old.revision.split(":");
        const priorSequence = Number(old.revision.split(":").at(-1));
        const sequence = "sequence" in payload ? payload.sequence : priorSequence;

        // Notifications can be duplicated and delivered out of order. Only a
        // newer revision invalidates; history remains the source of truth.
        if (thread.updatedAt < Number(timestamp)) return;

        if (
          thread.updatedAt > Number(timestamp) ||
          status !== thread.status ||
          sequence > priorSequence
        )
          store.invalidate(thread.id);
        else store.wake(thread.id);
      } else if (config.captureEnabled && store.subjects().length < 100) {
        store.touch(thread.id, thread.projectId, "pending");
      }

      publish();
    });
  }

  for (const event of ["thread.archived", "thread.deleted"] as const)
    bb.events.on(event, ({ thread }) => {
      store.forget(thread.id);
      publish();
    });

  async function replay(input: { fixture: z.infer<typeof fixtureId>; threadId?: string }) {
    if (!config.attentionEnabled || !config.fixtureMode)
      throw new Error("Enable attention and explicit fixture mode in Jev settings first.");
    const signal = AbortSignal.any([generation.signal, AbortSignal.timeout(10000)]);
    let packet = fixturePacket(input.fixture);

    if (input.threadId) {
      const head = await revisionOf(bb.sdk.threads, input.threadId, signal);
      signal.throwIfAborted();

      if (
        !config.approvedProject ||
        head.thread.projectId !== config.approvedProject ||
        head.thread.archivedAt !== null ||
        head.thread.deletedAt !== null ||
        head.thread.visibility === "hidden"
      )
        throw new Error("Choose a visible thread in the approved project.");

      if (head.thread.status !== "idle")
        throw new Error("Fixture previews require an idle thread.");
      packet = fixturePacket(
        input.fixture,
        input.threadId,
        input.threadId,
        head.thread.projectId,
        head.revision,
      );
      packet.sequence = head.sequence;
      packet.environmentId = head.thread.environmentId;
    }

    // One preview per subject; selecting another fixture supersedes the previous result.
    store.touch(packet.subjectId, packet.projectId, packet.revision, packet.threadId);
    const id = store.enqueue(packet);
    publish();

    return { id };
  }

  function requireLive() {
    if (!config.attentionEnabled || !config.liveEnabled)
      throw new Error("Enable attention and live Gateway evaluation first.");

    if (!config.gatewayApiKey) throw new Error("Configure the server-side Gateway key first.");
  }

  async function check({ threadId }: { threadId: string }) {
    requireLive();

    if (!config.approvedProject) throw new Error("Select the approved project first.");
    const signal = AbortSignal.any([generation.signal, AbortSignal.timeout(10000)]);
    const head = await revisionOf(bb.sdk.threads, threadId, signal);
    signal.throwIfAborted();

    if (
      head.thread.projectId !== config.approvedProject ||
      head.thread.status !== "idle" ||
      head.thread.archivedAt !== null ||
      head.thread.deletedAt !== null ||
      head.thread.visibility !== "visible"
    )
      throw new Error("Choose an idle, visible thread in the approved project.");
    store.touch(threadId, head.thread.projectId, head.revision);

    const packet = await captureHistory(
      bb.sdk.threads,
      store,
      threadId,
      config.approvedProject,
      config.maxEvidenceChars,
      config.gatewayApiKey ?? "",
      signal,
    );

    signal.throwIfAborted();

    if (!packet) throw new Error("History capture is still catching up; try again shortly.");
    const id = store.enqueue(packet, "gateway", config.requireZdr);
    publish();

    return { id };
  }

  function checkFixture({ fixture }: { fixture: z.infer<typeof fixtureId> }) {
    requireLive();
    const packet = fixturePacket(fixture, `gateway-fixture:${fixture}`);
    store.touch(packet.subjectId, null, packet.revision, null);
    const id = store.enqueue(packet, "gateway", config.requireZdr);
    publish();

    return { id };
  }

  bb.rpc.register(rpcContract, {
    list: async ({ threadId }) => {
      const signal = AbortSignal.any([generation.signal, AbortSignal.timeout(10000)]);
      const results = config.attentionEnabled ? store.list(threadId) : [];
      const eligibleThreadIds: string[] = [];

      for (const result of results) {
        if (!result.current || !result.packet.threadId) continue;

        try {
          const head = await revisionOf(bb.sdk.threads, result.packet.threadId, signal);
          result.current =
            head.revision === result.packet.revision &&
            head.thread.archivedAt === null &&
            head.thread.deletedAt === null;

          const interactions = await bb.sdk.threads.interactions.list({
            threadId: result.packet.threadId,
            signal,
          });

          if (
            result.current &&
            head.thread.status === "idle" &&
            head.thread.runtime.displayStatus === "idle" &&
            head.thread.queuedMessageCount === 0 &&
            head.thread.activeBackgroundAgentCount === 0 &&
            interactions.length === 0
          )
            eligibleThreadIds.push(result.packet.threadId);
        } catch {
          result.current = false;
        }
      }

      signal.throwIfAborted();

      return {
        enabled: config.attentionEnabled,
        fixtureMode: config.fixtureMode,
        liveEnabled: config.liveEnabled,
        requireZdr: config.requireZdr,
        keyConfigured: Boolean(config.gatewayApiKey),
        requestsToday: store.requestsToday(),
        dailyRequestLimit: config.dailyRequestLimit,
        issue,
        eligibleThreadIds,
        results,
      };
    },
    replay,
    check,
    checkFixture,
    annotate: ({ id, revision, annotation }) => {
      const changed = store.annotate(id, revision, annotation);
      publish();

      return { changed };
    },
    clear: () => {
      cancel();
      store.clear();
      publish();

      return { cleared: true };
    },
  });
  bb.cli.register({
    name: "jev",
    summary: "Inspect attention, replay fixtures, or request Gateway checks",
    commands: [
      {
        name: "eval",
        summary: "Queue a reviewed fixture",
        usage: "bb jev eval replay <fixture-id>",
      },
      {
        name: "check",
        summary: "Evaluate approved thread evidence with configured retention",
        usage: "bb jev check <thread-id>",
      },
      {
        name: "smoke",
        summary: "Evaluate synthetic evidence with configured retention",
        usage: "bb jev smoke <fixture-id>",
      },
      {
        name: "key-from-env",
        summary: "Import a key without exposing it",
        usage: "bb jev key-from-env <absolute-server-local-dotenv-path>",
      },
      { name: "list", summary: "Read bounded stored results", usage: "bb jev list" },
      { name: "clear", summary: "Remove Jev-owned evidence and results", usage: "bb jev clear" },
    ],
    async run(argv) {
      if (argv.length === 2 && argv[0] === "key-from-env") {
        const path = argv[1]!;

        if (!isAbsolute(path)) throw new Error("Use an absolute server-local secret dotenv path.");
        const info = await stat(path);

        if (!info.isFile() || info.size > 65536 || (info.mode & 0o077) !== 0)
          throw new Error("Secret file must be a private regular file, at most 64 KiB.");
        const key = parseEnv(await readFile(path, "utf8")).AI_GATEWAY_API_KEY;

        if (!key?.trim()) throw new Error("Secret file must contain AI_GATEWAY_API_KEY.");
        await settings.experimental_set({ gatewayApiKey: key });

        return {
          exitCode: 0,
          stdout: "Gateway key saved to BB server-only secret settings. Value not displayed.",
        };
      }

      if (argv.length === 2 && argv[0] === "check")
        return { exitCode: 0, stdout: JSON.stringify(await check({ threadId: argv[1]! })) };

      if (argv.length === 2 && argv[0] === "smoke")
        return {
          exitCode: 0,
          stdout: JSON.stringify(checkFixture({ fixture: fixtureId.parse(argv[1]) })),
        };

      if (argv.length === 1 && argv[0] === "list")
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            store.list().map((r) => ({
              id: r.id,
              threadId: r.packet.threadId,
              fixture: r.packet.fixture,
              revision: r.packet.revision,
              label: r.verdict.label,
              execution: r.verdict.execution,
              model: r.verdict.model,
              usage: r.verdict.usage,
              detail: r.verdict.uncertainty,
              current: r.current,
              annotation: r.annotation,
            })),
          ),
        };

      if (argv.length === 1 && argv[0] === "clear") {
        cancel();
        store.clear();
        publish();

        return { exitCode: 0, stdout: "Jev data cleared." };
      }

      if (argv.length === 4 && argv[0] === "eval" && argv[1] === "replay")
        return { exitCode: 1, stderr: "Expected a single fixture ID." };
      const parsed = fixtureId.safeParse(argv[2]);

      if (argv.length === 3 && argv[0] === "eval" && argv[1] === "replay" && parsed.success)
        return { exitCode: 0, stdout: JSON.stringify(await replay({ fixture: parsed.data })) };

      return {
        exitCode: 1,
        stderr: `Usage: bb jev eval replay <${Object.keys(fixtures).join("|")}> | list | clear`,
      };
    },
  });

  bb.background.service("attention", {
    async start(serviceSignal) {
      store.recover();
      let scanOffset = 0;
      let nextScan = 0;

      while (!serviceSignal.aborted && !disposed) {
        const signal = AbortSignal.any([serviceSignal, generation.signal]);

        const scan = Date.now() >= nextScan;

        if (scan) nextScan = Date.now() + 30000;

        try {
          if (config.attentionEnabled) {
            if (scan && config.captureEnabled && config.approvedProject) {
              const threads = await bb.sdk.threads.list({
                projectId: config.approvedProject,
                archived: false,
                includeHidden: false,
                limit: 20,
                offset: scanOffset,
                signal,
              });

              signal.throwIfAborted();
              scanOffset = threads.length === 20 ? scanOffset + 20 : 0;

              for (const thread of threads) {
                if (!store.subject(thread.id) && store.subjects().length < 100)
                  store.touch(thread.id, thread.projectId, "pending");
              }
            }

            for (const subject of store.subjects()) {
              if (!subject.thread_id || (!scan && !subject.dirty)) continue;

              try {
                const head = await revisionOf(bb.sdk.threads, subject.thread_id, signal);
                signal.throwIfAborted();

                if (
                  head.thread.deletedAt !== null ||
                  head.thread.archivedAt !== null ||
                  head.thread.projectId !== config.approvedProject ||
                  head.thread.visibility === "hidden"
                ) {
                  store.forget(subject.id);
                  publish();
                  continue;
                }

                if (head.revision !== subject.revision) {
                  store.touch(subject.id, subject.project_id, head.revision, subject.thread_id);
                  publish();
                }

                if (config.captureEnabled && config.approvedProject) {
                  const packet = await captureHistory(
                    bb.sdk.threads,
                    store,
                    subject.thread_id,
                    config.approvedProject,
                    config.maxEvidenceChars,
                    config.gatewayApiKey ?? "",
                    signal,
                  );

                  signal.throwIfAborted();

                  if (packet)
                    store.enqueue(
                      packet,
                      config.liveEnabled && config.automaticChecks && head.thread.status === "idle"
                        ? "gateway"
                        : "offline",
                      config.requireZdr,
                    );
                } else {
                  store.settled(subject.id);
                }
              } catch {
                signal.throwIfAborted();
                issue =
                  "Some thread history is unavailable. Its evidence may be incomplete; other checks can continue.";
                publish();
              }
            }

            // One backend evaluator; frontend windows cannot multiply inference.
            for (let count = 0; count < 20; count++) {
              signal.throwIfAborted();
              const job = store.claim();

              if (!job) break;

              try {
                const packet = packetSchema.parse(JSON.parse(job.packet));
                let verdict;

                if (job.evaluator === "gateway") {
                  requireLive();

                  if (packet.threadId) {
                    const before = await revisionOf(bb.sdk.threads, packet.threadId, signal);

                    if (
                      before.revision !== packet.revision ||
                      before.thread.projectId !== config.approvedProject ||
                      before.thread.status !== "idle" ||
                      before.thread.visibility === "hidden" ||
                      before.thread.archivedAt !== null ||
                      before.thread.deletedAt !== null
                    ) {
                      store.invalidate(packet.subjectId);
                      continue;
                    }
                  }

                  const reservation = store.reserve(job, config.dailyRequestLimit);

                  if (!reservation) {
                    verdict = {
                      execution: "skipped" as const,
                      label: null,
                      uncertainty: "Daily Gateway request limit reached. No request sent.",
                      evidenceIds: [],
                      model: "typesafe-ai/jev" as const,
                      usage: 0,
                    };
                  } else {
                    verdict = await createGatewayEvaluator(
                      config.gatewayApiKey ?? "",
                      fetch,
                      config.requireZdr,
                    ).evaluate(packet, signal);
                    store.recordRequest(reservation, verdict);

                    if (verdict.metrics?.retryable && job.attempts < 2) {
                      store.retry(job);
                      issue = verdict.uncertainty;
                      publish();
                      break;
                    }
                  }
                } else {
                  verdict = await fixtureEvaluator.evaluate(packet, signal);
                }

                if (packet.threadId) {
                  const head = await revisionOf(bb.sdk.threads, packet.threadId, signal);
                  signal.throwIfAborted();

                  if (head.revision !== packet.revision) store.invalidate(packet.subjectId);
                }

                signal.throwIfAborted();

                if (store.complete(job, verdict)) {
                  issue =
                    verdict.execution === "error" || verdict.execution === "timeout"
                      ? verdict.uncertainty
                      : null;
                  publish();
                }
              } catch (error) {
                if (!signal.aborted) {
                  if (job.evaluator === "gateway")
                    store.complete(job, {
                      execution: "error",
                      label: null,
                      evidenceIds: [],
                      model: "typesafe-ai/jev",
                      usage: null,
                      uncertainty:
                        "Live check interrupted by a state or history error. Delivery and usage may be unknown; it was not automatically retried.",
                    });
                  else store.retry(job);
                }

                throw error;
              }
            }

            store.prune(config.retentionDays);
          }
        } catch {
          if (!signal.aborted && !disposed) {
            issue =
              "A check was deferred. Evidence may be incomplete; no external action was performed.";
            publish();
            bb.log.warn(
              "Jev check deferred; evidence may be incomplete. No classification or external action was performed.",
            );
          }
        }

        try {
          await delay(1000, undefined, { signal: serviceSignal });
        } catch {
          return;
        }
      }
    },
  });
}
