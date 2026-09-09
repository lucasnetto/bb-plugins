import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { name: "fonts", include: ["tests/**/*.test.{ts,tsx}"], environment: "jsdom" },
});
