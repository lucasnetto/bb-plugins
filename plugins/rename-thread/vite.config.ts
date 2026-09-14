import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { name: "rename-thread", include: ["tests/**/*.test.ts"], environment: "node" },
});
