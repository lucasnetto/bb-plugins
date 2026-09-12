import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["**/dist/**"],
  },
  fmt: { ignorePatterns: ["**/dist/**", "pnpm-lock.yaml"] },
  test: {
    projects: [
      "plugins/t3-sidebar",
      "plugins/hide-models",
      "plugins/pr-review",
      "plugins/workers",
      "plugins/fonts",
      "plugins/cursor-sdk",
    ],
  },
});
