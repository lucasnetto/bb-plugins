import { z } from "zod";

export const fixtureId = z.enum([
  "decision",
  "rhetorical",
  "quoted",
  "credentials",
  "unrelated-error",
  "uncertain",
]);

export const label = z.enum(["needs_decision", "environment_blocked"]);

export const evidenceSchema = z
  .object({
    id: z.string(),
    sourceId: z.string(),
    sequence: z.number().int(),
    kind: z.enum(["thread_event", "fixture"]),
    text: z.string().max(16000),
    truncated: z.boolean(),
    role: z.enum(["user", "assistant", "unknown"]).default("unknown"),
  })
  .strict();

export const packetSchema = z
  .object({
    version: z.literal(1),
    subjectId: z.string(),
    threadId: z.string().nullable(),
    projectId: z.string().nullable(),
    environmentId: z.string().nullable(),
    revision: z.string(),
    sequence: z.number().int(),
    fixture: fixtureId.nullable(),
    evidence: z.array(evidenceSchema).max(100),
    coverage: z.enum(["bounded", "fixture"]),
    omitted: z.number().int().nonnegative(),
    ruleVersion: z.literal("attention-1"),
    contextVersion: z.literal("visible-events-1"),
  })
  .strict();

export type Packet = z.infer<typeof packetSchema>;

export const verdictSchema = z
  .object({
    execution: z.enum(["ok", "skipped", "error", "timeout"]),
    label: label.nullable(),
    uncertainty: z.string(),
    evidenceIds: z.array(z.string()),
    model: z.enum(["offline-fixture-v1", "typesafe-ai/jev"]),
    usage: z.number().int().nonnegative().nullable(),
    metrics: z
      .object({
        inputTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        latencyMs: z.number().nonnegative(),
        requestedModel: z.string(),
        returnedModel: z.string().nullable(),
        resolvedModel: z.string().nullable(),
        zeroDataRetention: z.boolean(),
        probabilities: z.record(z.string(), z.number().min(0).max(1)).nullable(),
        retryable: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Verdict = z.infer<typeof verdictSchema>;

export const resultSchema = z
  .object({
    id: z.string(),
    packet: packetSchema,
    verdict: verdictSchema,
    annotation: z.enum(["dismissed", "incorrect"]).nullable(),
    current: z.boolean(),
    createdAt: z.number(),
  })
  .strict();

export type Result = z.infer<typeof resultSchema>;

export type FixtureId = z.infer<typeof fixtureId>;

export const fixtures: Record<
  FixtureId,
  { title: string; text: string; label: Verdict["label"]; uncertainty: string }
> = {
  decision: {
    title: "A genuine decision",
    text: "Should I use SQLite or PostgreSQL? I need your choice before implementing storage.",
    label: "needs_decision",
    uncertainty: "A direct choice blocks the next step in this reviewed fixture.",
  },
  rhetorical: {
    title: "A rhetorical question",
    text: "Why duplicate this logic? I consolidated it and the tests pass.",
    label: null,
    uncertainty: "The question is rhetorical; no user decision is requested.",
  },
  quoted: {
    title: "A quoted question",
    text: "The README example says “Should I use SQLite?” I updated that quotation.",
    label: null,
    uncertainty: "Quoted source text is not a request to the user.",
  },
  credentials: {
    title: "Missing credentials",
    text: "The test service cannot authenticate because its API key is missing. Please configure the credential to continue.",
    label: "environment_blocked",
    uncertainty: "An explicit missing credential prevents progress in this fixture.",
  },
  "unrelated-error": {
    title: "A recovered test failure",
    text: "The assertion failed. I corrected the expected value and the suite now passes.",
    label: null,
    uncertainty: "A recovered assertion is not an environment blocker.",
  },
  uncertain: {
    title: "Insufficient context",
    text: "Something seems unavailable.",
    label: null,
    uncertainty: "Insufficient context: do not infer a blocker or a decision.",
  },
};

export interface Evaluator {
  evaluate(packet: Packet, signal: AbortSignal): Promise<Verdict>;
}

export const fixtureEvaluator: Evaluator = {
  async evaluate(packet, signal) {
    signal.throwIfAborted();
    const selected = packet.fixture === null ? null : fixtures[packet.fixture];

    // Fixture identity alone never authorizes classifying arbitrary content.
    const exact =
      selected !== null &&
      packet.evidence.length === 1 &&
      packet.evidence[0]?.kind === "fixture" &&
      packet.evidence[0].text === selected.text;

    if (!exact)
      return {
        execution: "skipped",
        label: null,
        uncertainty:
          "Live evaluation was not requested. Captured evidence has not been classified.",
        evidenceIds: [],
        model: "offline-fixture-v1",
        usage: 0,
      };

    return {
      execution: "ok",
      label: selected.label,
      uncertainty: selected.uncertainty + " Fixture replay does not measure live Jev accuracy.",
      evidenceIds: packet.evidence.map((e) => e.id),
      model: "offline-fixture-v1",
      usage: 0,
    };
  },
};

export function redact(text: string, secret = ""): string {
  let safe = secret ? text.split(secret).join("[REDACTED]") : text;
  safe = safe.replace(
    /-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?(?:-----END [\w ]*PRIVATE KEY-----|$)/g,
    "[REDACTED PRIVATE KEY]",
  );

  return safe
    .replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^\s"',;]+/gi,
      "credential=[REDACTED]",
    )
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g, "[REDACTED]");
}

export function fixturePacket(
  id: FixtureId,
  subjectId = `fixture:${id}`,
  threadId: string | null = null,
  projectId: string | null = null,
  revision = "fixture-v1",
): Packet {
  return {
    version: 1,
    subjectId,
    threadId,
    projectId,
    environmentId: null,
    revision,
    sequence: 0,
    fixture: id,
    evidence: [
      {
        id: `fixture:${id}:1`,
        sourceId: `fixtures/${id}`,
        sequence: 1,
        kind: "fixture",
        text: fixtures[id].text,
        truncated: false,
        role: "assistant",
      },
    ],
    coverage: "fixture",
    omitted: 0,
    ruleVersion: "attention-1",
    contextVersion: "visible-events-1",
  };
}
