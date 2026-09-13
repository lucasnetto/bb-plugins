import { expect, test } from "vite-plus/test";
import { Schema } from "effect";
import { promptInputSchema, threadEnvironmentSchema } from "../../src/shared/thread-input-schema";

const decodeInput = Schema.decodeUnknownSync(promptInputSchema);

const decodeEnvironment = Schema.decodeUnknownSync(threadEnvironmentSchema);

test("prompt validation supplies the SDK mention default and preserves valid resources", () => {
  expect(decodeInput([{ type: "text", text: "hello" }])).toEqual([
    { type: "text", text: "hello", mentions: [] },
  ]);

  const resources = [
    { kind: "thread", label: "Thread", threadId: "t1", projectId: "p1" },
    { kind: "project", label: "Project", projectId: "p1" },
    { kind: "section", label: "Section", sectionId: "s1" },
    { kind: "path", label: "File", path: "src/main.ts", entryKind: "file", source: "workspace" },
    {
      kind: "command",
      label: "Review",
      name: "review",
      argumentHint: null,
      origin: "user",
      source: "skill",
      trigger: "/",
    },
    { kind: "plugin", label: "Item", itemId: "i1", pluginId: "plugin", icon: null },
  ];

  const input = resources.map((resource) => ({
    type: "text",
    text: "mention",
    visibility: "agent-only",
    mentions: [{ start: 0, end: 7, resource }],
  }));

  expect(decodeInput(input)).toEqual(input);
});

test.each([
  [{ type: "text" }],
  [{ type: "text", text: "hello", mentions: [{ start: 0, end: 5, resource: { kind: "thread" } }] }],
  [{ type: "image", url: 42 }],
  [{ type: "localImage" }],
  [{ type: "localFile", path: "file.txt", sizeBytes: "12" }],
])("prompt discriminator alone cannot establish the payload contract: %j", (block) => {
  expect(() => decodeInput([block])).toThrow();
});

test.each([
  { type: "reuse" },
  { type: "host" },
  { type: "host", workspace: { type: "unmanaged", path: 42 } },
  { type: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "named" } } },
])("environment discriminator alone cannot establish the payload contract: %j", (environment) => {
  expect(() => decodeEnvironment(environment)).toThrow();
});
