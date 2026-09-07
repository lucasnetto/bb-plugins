import { defineConfig } from "vite-plus";
export default defineConfig({
  test: { name: "pr-review", include: ["tests/**/*.test.{ts,tsx}"], environment: "node" },
});
