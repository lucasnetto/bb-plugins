import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { name: "profiles-ui", include: ["tests/**/*.test.tsx"], environment: "jsdom" },
});
