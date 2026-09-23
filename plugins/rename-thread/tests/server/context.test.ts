import { describe, expect, it } from "vite-plus/test";
import { titleContext, titlePrompt } from "../../src/server/context";
import { normalizeTitle, profileCodexHome } from "../../src/server/codex";

describe("title context", () => {
  it("retains the original goal and latest steering within its budget", () => {
    const context = titleContext({ role: "USER", text: "Build automatic thread renaming" }, [
      { role: "ASSISTANT", text: "noise ".repeat(5000) },
      { role: "USER", text: "Keep Personal and Work accounts separate" },
    ]);

    expect(context.length).toBeLessThanOrEqual(8000);
    expect(context).toContain("Build automatic thread renaming");
    expect(context).toContain("Keep Personal and Work accounts separate");
    expect(titlePrompt("Old title", context)).toContain('"previousTitle":"Old title"');
  });
  it("does not manufacture a context for an empty conversation", () => {
    expect(titleContext(null, [])).toBe("");
  });
  it("rejects placeholder and excessively long output", () => {
    expect(() => normalizeTitle("New thread")).toThrow();
    expect(() => normalizeTitle("x".repeat(81))).toThrow();
    expect(normalizeTitle(' "Automatic thread renaming" ')).toBe("Automatic thread renaming");
  });
  it("never inherits the other local profile's login", () => {
    expect(profileCodexHome("/profiles/.bb-work")).toMatch(/\.codex_work$/);
    expect(profileCodexHome("/profiles/.bb")).toMatch(/\.codex$/);
    expect(() => profileCodexHome("/unknown")).toThrow(/configured Personal or Work/);
  });
});
