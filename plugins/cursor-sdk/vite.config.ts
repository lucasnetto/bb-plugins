import { defineConfig } from "vite-plus";
export default defineConfig({
  test: {
    name: "cursor-sdk",
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
