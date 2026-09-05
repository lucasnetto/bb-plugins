import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { name: "hide-models", include: ["tests/**/*.test.{ts,mjs}"], environment: "node" },
});
