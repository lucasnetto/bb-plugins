import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    name: "environment-recovery",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
  },
});
