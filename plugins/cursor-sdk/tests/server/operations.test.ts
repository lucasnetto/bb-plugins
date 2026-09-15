import { expect, test } from "vite-plus/test";
import { Effect } from "effect";
import {
  sdkError,
  sdkErrorInfo,
  sdkRecovery,
  foreign,
  SdkError,
} from "../../src/server/operations.js";

test.each([
  [401, "unauthorized", "authRequired"],
  [429, "rate-limit", "rateLimited"],
  [400, "bad-request", undefined],
  [403, "policy", undefined],
  [503, "connection-failed", undefined],
  [500, "internal", undefined],
] as const)(
  "maps HTTP %s without inferring recovery from message text",
  (status, category, recovery) => {
    const error = sdkError(
      Object.assign(new Error("authRequired rate limit crsr_secret"), {
        status,
        code: "vendor_code",
        isRetryable: true,
        requestId: "request-12",
      }),
    );

    expect(error).toBeInstanceOf(SdkError);
    expect(error.message).toBe("authRequired rate limit [redacted]");
    expect(error.isRetryable).toBe(true);
    expect(error.requestId).toBe("request-12");
    expect(sdkErrorInfo(error)).toEqual({
      category,
      httpStatusCode: status,
      providerCode: "vendor_code",
    });
    expect(sdkRecovery(error)?.kind).toBe(recovery);

    if (recovery) expect(sdkRecovery(error)?.retryable).toBe(false);
  },
);

test("unknown and malformed errors retain a safe message without invented metadata", () => {
  for (const value of [
    null,
    "Rate limit exceeded",
    new Error("Authentication failed"),
    { message: "Bad", status: "401", code: 42, isRetryable: "true" },
  ]) {
    const error = sdkError(value);
    expect(sdkErrorInfo(error).category).toBe("unknown");
    expect(error.status).toBeUndefined();
    expect(error.isRetryable).toBeUndefined();
    expect(sdkRecovery(error)).toBeUndefined();
  }

  expect(
    sdkError({ message: "Failure", code: "Bearer secret", requestId: "crsr_key" }),
  ).toMatchObject({ code: "Bearer [redacted]", requestId: "[redacted]" });
});

test("foreign failures remain typed Effect errors with SDK metadata intact", async () => {
  const result = await Effect.runPromise(
    foreign(async () => {
      throw Object.assign(new Error("Unavailable"), {
        status: 503,
        code: "backend",
        isRetryable: false,
      });
    }).pipe(Effect.catch((error) => Effect.succeed(error))),
  );

  expect(result).toMatchObject({
    message: "Unavailable",
    status: 503,
    code: "backend",
    isRetryable: false,
  });
});
