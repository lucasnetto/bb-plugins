import assert from "node:assert/strict";
import { test } from "node:test";
import { StartupFailure, retryConnection, startupStep } from "../task-startup.ts";
import { verifyReadiness } from "../task-readiness.ts";
import { command } from "../task-process.ts";

test("connection retry is bounded and never retries configuration or authentication", async () => {
  const signal = new AbortController().signal;
  for (const error of [
    new StartupFailure("authentication-failed", "Sign in"),
    new Error("bad config"),
    Object.assign(new Error(), { code: "ENOENT" }),
  ]) {
    let attempts = 0;
    await assert.rejects(
      retryConnection(
        async () => {
          attempts++;
          throw error;
        },
        signal,
        () => {},
        async () => {},
      ),
    );
    assert.equal(attempts, 1);
  }
  let attempts = 0;
  await assert.rejects(
    retryConnection(
      async () => {
        attempts++;
        throw Object.assign(new Error(), { cause: { code: "ECONNRESET" } });
      },
      signal,
      () => {},
      async () => {},
    ),
  );
  assert.equal(attempts, 3);
  attempts = 0;
  assert.equal(
    await retryConnection(
      async () => {
        if (++attempts === 1) throw Object.assign(new Error(), { code: "ECONNREFUSED" });
        return "connected";
      },
      signal,
      () => {},
      async () => {},
    ),
    "connected",
  );
});

test("cancellation prevents retries and keeps the original abort reason", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled");
  controller.abort(reason);
  await assert.rejects(
    retryConnection(
      async () => assert.fail(),
      controller.signal,
      () => {},
    ),
    (error) => error === reason,
  );
});

test("startup errors retain categories without credential-bearing subprocess output", async () => {
  await assert.rejects(
    startupStep(
      "authentication-failed",
      "Sign in on the Mac",
      new AbortController().signal,
      async () => {
        throw new Error("private-token");
      },
    ),
    (error) =>
      error instanceof StartupFailure &&
      error.category === "authentication-failed" &&
      !error.message.includes("private-token"),
  );
  const original = new StartupFailure("incompatible-runtime", "Update Codex");
  await assert.rejects(
    startupStep("host-unavailable", "Check host", new AbortController().signal, async () => {
      throw original;
    }),
    (error) => error === original,
  );
});

test("readiness reports optional accounts, rejects invalid workspaces and disconnected hosts", () => {
  const messages: string[] = [];
  const optional = {
    name: "Cursor",
    ok: false,
    required: false,
    category: "authentication-failed" as const,
    detail: "Sign in",
  };
  verifyReadiness([optional], (text) => messages.push(text));
  assert.match(messages[0]!, /^WARN/);
  for (const category of [
    "unsupported-workspace",
    "host-unavailable",
    "incompatible-runtime",
    "authentication-failed",
  ] as const) {
    assert.throws(
      () => verifyReadiness([{ ...optional, required: true, category }], () => {}),
      (error) => error instanceof StartupFailure && error.category === category,
    );
  }
});

test("command distinguishes missing binaries, timeout and abort without echoing arguments", async () => {
  await assert.rejects(
    command(["/no-such-orbisa-test-binary", "private-token"]),
    (error: any) => error.code === "ENOENT" && !error.message.includes("private-token"),
  );
  await assert.rejects(
    command([process.execPath, "-e", "setTimeout(()=>{},10000)"], { timeoutMs: 20 }),
    (error: any) => error.code === "ETIMEDOUT",
  );
});

test("missing authentication executable is a runtime failure rather than a login failure", async () => {
  await assert.rejects(
    startupStep("authentication-failed", "Sign in", new AbortController().signal, async () => {
      throw Object.assign(new Error("private arguments"), { code: "ENOENT" });
    }),
    (error) =>
      error instanceof StartupFailure &&
      error.category === "incompatible-runtime" &&
      !error.message.includes("private arguments"),
  );
});
