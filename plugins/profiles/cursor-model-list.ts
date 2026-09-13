import { experimental_acpLaunchSpecSchema } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { z } from "zod";

const modelListRequest = z
  .object({
    method: z.literal("model/list"),
    params: z
      .object({
        providerOptions: z
          .object({
            acpDialect: z.literal("cursor"),
            acpLaunchSpec: experimental_acpLaunchSpecSchema,
            excludedCursorModelIds: z.array(z.string()),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

// Run only for catalog reads. Sessions and credential lookup keep using the
// account launcher directly. Arguments are passed to execFileSync, never a shell.
const filterModelList = String.raw`
const { execFileSync } = require("node:child_process");
const [command, excludedJson, ...args] = process.argv.slice(1);
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const output = execFileSync(command, args, {
    encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], env,
  });
  const excluded = new Set(JSON.parse(excludedJson));
  process.stdout.write(output.split("\n").filter(line => {
    const model = /^\s*(\S+)\s+-\s/.exec(line)?.[1];
    return !excluded.has(model);
  }).join("\n"));
} catch (error) {
  process.stderr.write(error.stderr?.toString() || error.message);
  process.exit(Number.isInteger(error.status) && error.status > 0 ? error.status : 1);
}
`;

export function cursorModelListRequest(line: string): string {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    return line;
  }

  const parsed = modelListRequest.safeParse(value);

  if (!parsed.success) return line;
  const request = parsed.data;
  const options = request.params.providerOptions;
  const launch = options.acpLaunchSpec;

  if (!launch.modelCli || options.excludedCursorModelIds.length === 0) return line;
  options.acpLaunchSpec = {
    ...launch,
    command: process.execPath,
    // The installed bb runs the bridge in Electron. The ACP bridge removes
    // its own runtime flags before spawning a CLI, so restore Node mode for
    // this helper only; the helper removes it before running Cursor.
    env: { ...launch.env, ELECTRON_RUN_AS_NODE: "1" },
    modelCli: {
      ...launch.modelCli,
      listArgs: [
        "-e",
        filterModelList,
        launch.command,
        JSON.stringify(options.excludedCursorModelIds),
        ...launch.modelCli.listArgs,
      ],
    },
  };

  return JSON.stringify(request);
}
