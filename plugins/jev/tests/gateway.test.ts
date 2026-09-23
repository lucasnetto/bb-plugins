import { expect, it } from "vite-plus/test";
import { createGatewayEvaluator, gatewayFetch } from "../src/gateway";
import { fixturePacket } from "../src/domain";

function response(choice = "needs_decision", source = "fixture:decision:1") {
  return {
    answers: {
      attention: {
        type: "choice",
        choice,
        probabilities: {
          needs_decision: 0.94,
          environment_blocked: 0.02,
          none: 0.02,
          insufficient_context: 0.02,
        },
      },
      evidence: { type: "choice", choice: source },
    },
    usage: { inputTokens: 150, outputTokens: 12 },
  };
}

it.each([true, false])(
  "uses the actual SDK wire format with requireZdr=%s and no fallback",
  async (requireZdr) => {
    const calls: string[] = [];

    const transport: typeof fetch = async (input, init) => {
      calls.push(input instanceof Request ? input.url : input.toString());
      const body = JSON.parse(await new Response(init?.body).text());
      expect(body.providerOptions.gateway).toEqual({
        zeroDataRetention: requireZdr,
        disallowPromptTraining: true,
      });
      expect(body.state.evidence[0].text).not.toContain("secret-canary");
      expect(new Headers(init?.headers).get("ai-model-id")).toBe("typesafe-ai/jev");

      return Response.json(response());
    };

    const packet = fixturePacket("decision");
    packet.evidence[0]!.text += " secret-canary";

    const result = await createGatewayEvaluator("secret-canary", transport, requireZdr).evaluate(
      packet,
      new AbortController().signal,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/evaluation-model");
    expect(result).toMatchObject({
      label: "needs_decision",
      usage: 162,
      metrics: {
        zeroDataRetention: requireZdr,
        resolvedModel: null,
        inputTokens: 150,
        outputTokens: 12,
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret-canary");
  },
);

it.each([401, 403, 429, 500, 503])(
  "returns a sanitized HTTP %s failure, with no SDK retries",
  async (status) => {
    let calls = 0;

    const result = await createGatewayEvaluator("secret-canary", async () => {
      calls++;

      return Response.json({ error: "secret-canary" }, { status });
    }).evaluate(fixturePacket("decision"), new AbortController().signal);

    expect(calls).toBe(1);
    expect(result.execution).toBe("error");
    expect(result.label).toBeNull();
    expect(JSON.stringify(result)).not.toContain("secret-canary");
    expect(result.metrics?.retryable).toBe(status === 429 || status >= 500);
  },
);

it("rejects malformed probabilities, unknown choices and missing answers", async () => {
  for (const body of [
    { answers: {} },
    response("invented"),
    response("needs_decision", "fake-id"),
    {
      ...response(),
      answers: {
        ...response().answers,
        attention: {
          type: "choice",
          choice: "needs_decision",
          probabilities: {
            needs_decision: 2,
            environment_blocked: 0,
            none: 0,
            insufficient_context: 0,
          },
        },
      },
    },
  ]) {
    const result = await createGatewayEvaluator("test", async () => Response.json(body)).evaluate(
      fixturePacket("decision"),
      new AbortController().signal,
    );

    expect(result.execution).toBe("error");
    expect(result.label).toBeNull();
  }
});

it("abstains when probabilities are missing and records unknown usage", async () => {
  const result = await createGatewayEvaluator("test", async () =>
    Response.json({
      answers: {
        attention: { type: "choice", choice: "needs_decision" },
        evidence: { type: "choice", choice: "fixture:decision:1" },
      },
    }),
  ).evaluate(fixturePacket("decision"), new AbortController().signal);

  expect(result).toMatchObject({ execution: "ok", label: null, usage: null });
});

it("blocks oversized responses, foreign origins and cancelled work", async () => {
  const result = await createGatewayEvaluator(
    "test",
    async () => new Response("x".repeat(65537)),
  ).evaluate(fixturePacket("decision"), new AbortController().signal);

  expect(result.execution).toBe("error");
  await expect(gatewayFetch(async () => Response.json({}))("https://example.com")).rejects.toThrow(
    "Unapproved",
  );
  const abort = new AbortController();
  abort.abort();
  await expect(
    createGatewayEvaluator("test").evaluate(fixturePacket("decision"), abort.signal),
  ).rejects.toThrow();
});
