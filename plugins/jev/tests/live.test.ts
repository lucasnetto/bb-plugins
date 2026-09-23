import { it, expect } from "vite-plus/test";
import { loadEnvFile } from "node:process";
import { writeFile } from "node:fs/promises";
import { createGatewayEvaluator } from "../src/gateway";
import { fixturePacket } from "../src/domain";

// Explicit opt-in only. Never part of ordinary tests; no credential values are logged.
it.skipIf(process.env.JEV_LIVE_SMOKE !== "1")(
  "approved synthetic Gateway smoke with configured retention",
  async () => {
    const path = process.env.JEV_SECRET_FILE;

    if (!path) throw new Error("Provide the secure dotenv file path");
    loadEnvFile(path);
    const requireZdr = process.env.JEV_REQUIRE_ZDR !== "false";

    const evaluator = createGatewayEvaluator(
      process.env.AI_GATEWAY_API_KEY ?? "",
      fetch,
      requireZdr,
    );

    const result = await evaluator.evaluate(
      fixturePacket("decision"),
      new AbortController().signal,
    );

    const report = { kind: "synthetic-live-smoke", ...result };

    if (process.env.JEV_REPORT_FILE)
      await writeFile(process.env.JEV_REPORT_FILE, JSON.stringify(report, null, 2), {
        mode: 0o600,
      });
    expect(result.execution, result.uncertainty).toBe("ok");
    expect(result.metrics?.zeroDataRetention).toBe(requireZdr);
  },
  30000,
);
