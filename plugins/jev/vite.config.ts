import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    name: "jev",
    // Avoid native SQLite cleanup across isolated VM contexts on Node 24.
    isolate: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 15000,
  },
});
