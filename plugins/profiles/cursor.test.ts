import assert from "node:assert/strict";
import { z } from "zod";
import test, { type TestContext } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { cursorModelListRequest } from "./cursor-model-list.ts";

const fixture = fileURLToPath(new URL("./fixtures/cursor-agent.mjs", import.meta.url));

const host = new URL("./host.ts", import.meta.url).href;

function providerOptions(excludedCursorModelIds: string[] = []) {
  return {
    acpDialect: "cursor",
    parameterizedModelPicker: true,
    excludedCursorModelIds,
    acpLaunchSpec: {
      displayName: "Cursor",
      command: process.execPath,
      args: [fixture],
      env: {},
      modelCli: { listArgs: [fixture, "--list-models"], primaryModels: [] },
    },
  };
}

void test("model-list filtering removes only rejected aliases and preserves account failures", () => {
  const original = {
    jsonrpc: "2.0",
    id: 1,
    method: "model/list",
    params: { providerOptions: providerOptions(["auto", "default"]) },
  };

  const request = JSON.parse(cursorModelListRequest(JSON.stringify(original)));
  const launch = request.params.providerOptions.acpLaunchSpec;

  const success = spawnSync(launch.command, launch.modelCli.listArgs, {
    encoding: "utf8",
    env: { ...process.env, ...launch.env },
  });

  assert.equal(success.status, 0, success.stderr);
  assert.doesNotMatch(success.stdout, /^(auto|default) - /m);
  assert.match(success.stdout, /claude-opus-5-thinking-max/);

  const failure = spawnSync(launch.command, launch.modelCli.listArgs, {
    encoding: "utf8",
    env: { ...process.env, ...launch.env, CURSOR_TEST_LIST_ERROR: "1" },
  });

  assert.equal(failure.status, 7);
  assert.equal(failure.stdout, "");
  assert.match(failure.stderr, /Cursor account unavailable/);
});

void test("catalog filtering leaves Personal, sessions, and malformed requests to the ACP bridge", () => {
  for (const line of [
    "invalid JSON",
    JSON.stringify({ method: "model/list", params: {} }),
    JSON.stringify({ method: "model/list", params: { providerOptions: providerOptions() } }),
    JSON.stringify({
      method: "thread/start",
      params: { options: { providerOptions: providerOptions(["auto"]) } },
    }),
  ]) {
    assert.equal(cursorModelListRequest(line), line);
  }
});

const responseSchema = z.object({
  id: z.number().optional(),
  result: z.json().optional(),
  error: z.object({ message: z.string() }).optional(),
});

type Response = z.infer<typeof responseSchema>;

const requestParamsSchema = z.record(z.string(), z.json());

type RequestParams = z.infer<typeof requestParamsSchema>;

const recordedRequestSchema = z.object({
  method: z.string(),
  params: z.object({ configId: z.string().optional(), value: z.string().optional() }),
});

const modelListSchema = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      isDefault: z.boolean(),
      supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })),
    }),
  ),
});

async function bridge(t: TestContext, env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "cursor bridge test "));
  const log = join(root, "requests.jsonl");

  const child = spawn(
    process.env.CURSOR_TEST_BRIDGE_EXECUTABLE ?? process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `
    import { createInterface } from 'node:readline';
    import { experimental_providerBridge as bridge } from ${JSON.stringify(host)};
    createInterface({ input: process.stdin }).on('line', bridge.handleLine).on('close', () => bridge.onClose?.());
  `,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CURSOR_TEST_LOG: log, ...env },
    },
  );

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const pending = new Map<
    number,
    { resolve: (response: Response) => void; reject: (error: Error) => void }
  >();

  createInterface({ input: child.stdout }).on("line", (line) => {
    const response = responseSchema.parse(JSON.parse(line));

    if (response.id !== undefined) {
      pending.get(response.id)?.resolve(response);
      pending.delete(response.id);
    }
  });
  child.on("exit", () => {
    for (const entry of pending.values()) entry.reject(new Error(stderr || "Bridge exited"));
  });
  t.after(async () => {
    const closed = once(child, "close");
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    await closed;
    clearTimeout(timer);
    rmSync(root, { recursive: true, force: true });
  });
  let nextId = 0;

  const request = (method: string, params: RequestParams) =>
    new Promise<Response>((resolve, reject) => {
      const id = ++nextId;

      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out: ${method}\n${stderr}`));
      }, 10000);

      pending.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  assert.equal(
    (await request("initialize", { protocolVersion: 2, client: { name: "test", version: "1" } }))
      .error,
    undefined,
  );

  return {
    request,
    root,
    requests: () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => recordedRequestSchema.parse(JSON.parse(line))),
  };
}

for (const profile of ["personal", "work"] as const) {
  void test(
    `${profile} catalog exposes actual effort variants through the published bridge`,
    { timeout: 15000 },
    async (t) => {
      const client = await bridge(t);

      const response = await client.request("model/list", {
        providerOptions: providerOptions(profile === "work" ? ["auto", "default"] : []),
      });

      assert.equal(response.error, undefined);

      const { models } = modelListSchema.parse(response.result);

      assert.equal(
        models.some((model) => model.id === "default"),
        profile === "personal",
      );
      assert.equal(models.filter((model) => model.isDefault).length, 1);
      assert.deepEqual(
        models
          .find((model) => model.id === "claude-opus-5")
          ?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
        ["none", "low", "medium", "high", "xhigh", "max"],
      );
    },
  );
}

for (const model of ["claude-opus-5", "gpt-5.6-sol"]) {
  for (const level of ["none", "low", "medium", "high", "xhigh", "max"]) {
    void test(`${model} applies ${level} to the ACP session`, { timeout: 15000 }, async (t) => {
      const client = await bridge(t, { CURSOR_TEST_THINKING: level === "none" ? "true" : "false" });

      const response = await client.request("thread/start", {
        threadId: `test-${model}-${level}`,
        cwd: client.root,
        instructionMode: "append",
        options: {
          model,
          reasoningLevel: level,
          permissionMode: "full",
          permissionScope: "full",
          approvalReviewer: null,
          permissionEscalation: null,
          providerOptions: providerOptions(),
        },
      });

      assert.equal(response.error, undefined, JSON.stringify(response));

      const selections = client
        .requests()
        .filter((request) => request.method === "session/set_config_option")
        .map((request) => [request.params.configId, request.params.value]);

      assert.deepEqual(
        selections,
        model.startsWith("claude")
          ? [
              ["model", model],
              ["thinking", level === "none" ? "false" : "true"],
              ...(level === "none" ? [] : [["effort", level]]),
            ]
          : [
              ["model", model],
              ["reasoning", level],
            ],
      );
    });
  }
}

void test(
  "rejected effort fails session setup instead of silently using the default",
  { timeout: 15000 },
  async (t) => {
    const client = await bridge(t, { CURSOR_TEST_REJECT_EFFORT: "1" });

    const response = await client.request("thread/start", {
      threadId: "test-rejected",
      cwd: client.root,
      instructionMode: "append",
      options: {
        model: "claude-opus-5",
        reasoningLevel: "high",
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
        providerOptions: providerOptions(),
      },
    });

    assert.match(response.error?.message ?? "", /Effort selection rejected/);
  },
);
