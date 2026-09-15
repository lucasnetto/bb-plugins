import { getFiletypeFromFileName, getSharedHighlighter } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";
import "../../../src/ui/review/languages";

describe("review syntax highlighting", () => {
  it.each(["deps.edn", "resources/problems/i80seg_product_errors.edn"])(
    "recognizes %s as Clojure",
    (path) => {
      expect(getFiletypeFromFileName(path)).toBe("clojure");
    },
  );

  it.each(["example.clj", "example.cljs", "example.cljc"])(
    "preserves Clojure detection for %s",
    (path) => {
      expect(getFiletypeFromFileName(path)).toBe("clojure");
    },
  );

  it("keeps unknown extensions as plain text", () => {
    expect(getFiletypeFromFileName("example.unknown-extension")).toBe("text");
  });

  it.each(["pierre-light", "pierre-dark"] as const)(
    "colors EDN keywords, strings, and numbers with %s",
    async (theme) => {
      const lang = getFiletypeFromFileName("errors.edn");
      const highlighter = await getSharedHighlighter({ themes: [theme], langs: [lang] });

      const { tokens } = highlighter.codeToTokens('{:title "Cancellation" :status 400}', {
        lang,
        theme,
      });

      const colorOf = (content: string) =>
        tokens.flat().find((token) => token.content === content)?.color;

      const colors = [colorOf(":title"), colorOf('"Cancellation"'), colorOf("400")];
      expect(colors.every((color) => color !== undefined)).toBe(true);
      expect(new Set(colors).size).toBe(3);
    },
  );
});
