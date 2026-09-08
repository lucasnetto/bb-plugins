import { defineConfig } from "vite-plus";
export default defineConfig({
  test: { name: "workers", include: ["tests/**/*.test.{ts,tsx}"], environment: "node" },
});
