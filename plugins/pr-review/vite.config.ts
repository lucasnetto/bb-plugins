import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "pr-review",
    // Cold imports of the SDK and diff UI can exceed Vitest's 5s default.
    testTimeout: 15000,
    include: ["tests/**/*.test.{ts,tsx,mjs}"],
    environment: "node",
  },
});
