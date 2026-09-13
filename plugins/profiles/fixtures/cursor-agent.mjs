import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.argv.includes("--list-models")) {
  if (process.env.ELECTRON_RUN_AS_NODE) {
    process.stderr.write("Bridge runtime flags must not reach the Cursor launcher\n");
    process.exit(8);
  }

  if (process.env.CURSOR_TEST_LIST_ERROR) {
    process.stderr.write("Cursor account unavailable\n");
    process.exit(7);
  }

  process.stdout.write(
    [
      "Available models",
      "",
      "auto - Auto (default)",
      "default - Auto",
      "claude-opus-5-low - Claude Opus 5 Low",
      "claude-opus-5-thinking-low - Claude Opus 5 Low Thinking",
      "claude-opus-5-thinking-medium - Claude Opus 5 Medium Thinking",
      "claude-opus-5-thinking-high - Claude Opus 5 Thinking",
      "claude-opus-5-thinking-xhigh - Claude Opus 5 Extra High Thinking",
      "claude-opus-5-thinking-max - Claude Opus 5 Max Thinking",
      "gpt-5.6-sol-low - GPT-5.6 Sol Low",
      "gpt-5.6-sol-high - GPT-5.6 Sol High",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

let model = "composer-2.5";

let thinking = process.env.CURSOR_TEST_THINKING ?? "false";

let effort = "low";

const choice = (value) => ({ value, name: value });

function configOptions() {
  const options = [
    {
      id: "model",
      category: "model",
      type: "select",
      currentValue: model,
      options: ["composer-2.5", "claude-opus-5", "gpt-5.6-sol"].map(choice),
    },
  ];

  if (model.startsWith("claude")) {
    options.push({
      id: "thinking",
      category: "thought_level",
      type: "select",
      currentValue: thinking,
      options: ["false", "true"].map(choice),
    });

    if (thinking === "true")
      options.push({
        id: "effort",
        category: "thought_level",
        type: "select",
        currentValue: effort,
        options: ["low", "medium", "high", "xhigh", "max"].map(choice),
      });
  } else if (model.startsWith("gpt")) {
    options.push({
      id: "reasoning",
      category: "thought_level",
      type: "select",
      currentValue: effort,
      options: ["none", "low", "medium", "high", "xhigh", "max"].map(choice),
    });
  }

  return options;
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  const { method, params } = request;

  if (process.env.CURSOR_TEST_LOG) appendFileSync(process.env.CURSOR_TEST_LOG, `${line}\n`);
  let result = {};
  let error;

  if (method === "initialize") result = { protocolVersion: 1, agentCapabilities: {} };
  else if (method === "session/new")
    result = { sessionId: "cursor-test-session", configOptions: configOptions() };
  else if (method === "session/set_config_option") {
    if (process.env.CURSOR_TEST_REJECT_EFFORT && params.configId === "effort") {
      error = { code: -32602, message: "Effort selection rejected" };
    } else {
      if (params.configId === "model") model = params.value;

      if (params.configId === "thinking") thinking = params.value;

      if (["effort", "reasoning"].includes(params.configId)) effort = params.value;
      result = { configOptions: configOptions() };
    }
  }

  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: request.id, ...(error ? { error } : { result }) })}\n`,
  );
});
