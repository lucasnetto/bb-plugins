import { createRequire } from "node:module";

// BB's bundled bridge kit contains CommonJS dependencies; the real daemon
// supplies require when importing its host artifact.
Object.assign(globalThis, { require: createRequire(import.meta.url) });
