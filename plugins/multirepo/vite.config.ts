import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "multirepo",
    include: ["tests/**/*.test.{ts,tsx,mjs}"],
    environment: "node",
  },
});
