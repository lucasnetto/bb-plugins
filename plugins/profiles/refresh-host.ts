import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { readFile, realpath, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { maintenanceTarget } from "./refresh-contract.ts";

const exec = promisify(execFile);

export function maintenanceEnvironment(
  input: z.infer<typeof maintenanceTarget>,
  inherited = process.env,
) {
  const url = new URL(input.url);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Administration requires a loopback URL on the selected machine.");
  const env = { ...inherited };

  for (const key of [
    "BB_THREAD_ID",
    "BB_PROJECT_ID",
    "BB_ENVIRONMENT_ID",
    "BB_HOST_DAEMON_PORT",
    "BB_SERVER_HEADERS",
    "BB_MACHINE_CREDENTIAL",
  ])
    delete env[key];
  env.BB_SERVER_URL = input.url;
  env.BB_DATA_DIR = input.dataDir || join(homedir(), input.profile === "work" ? ".bb-work" : ".bb");

  if (!isAbsolute(env.BB_DATA_DIR)) throw new Error("Profile data directory must be absolute.");

  return env;
}

export function maintenanceArguments(action: string, argument: string) {
  if (action === "list") return ["plugin", "list", "--json"];

  if (["reload", "disable"].includes(action)) {
    if (!/^[a-z][a-z0-9-]*$/.test(argument)) throw new Error("Invalid plugin ID.");

    return ["plugin", action, argument];
  }

  if (["build", "install"].includes(action) && isAbsolute(argument))
    return action === "build"
      ? ["plugin", "build", argument]
      : ["plugin", "install", `path:${argument}`, "--yes"];
  throw new Error("Unsupported maintenance operation.");
}

async function sourceInfo(path: string) {
  if (!isAbsolute(path)) throw new Error("Plugin source must be absolute.");
  const source = await realpath(path);
  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));

  try {
    const git = await exec("git", [
      "-C",
      source,
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
      "--git-common-dir",
    ]);

    const [gitDir, common] = git.stdout.trim().split("\n");

    if ((await realpath(gitDir)) !== (await realpath(common)))
      throw new Error("Plugin source is a task worktree.");
  } catch (error) {
    const failure = z.object({ stderr: z.string() }).safeParse(error);

    if (!failure.success || !failure.data.stderr.includes("not a git repository")) throw error;
  }

  const files = [join(source, "package.json")];

  async function walk(path: string) {
    let entries;

    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      const failure = z.object({ code: z.string() }).safeParse(error);

      if (failure.success && failure.data.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const child = join(path, entry.name);

      if (entry.isDirectory()) await walk(child);
      else if ((await stat(child)).isFile()) files.push(child);
    }
  }

  await walk(join(source, "dist"));
  await walk(join(source, "skills"));
  const hash = createHash("sha256");

  for (const file of files.sort()) {
    hash.update(relative(source, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }

  return JSON.stringify({
    path: source,
    name: manifest.name,
    hash: hash.digest("hex").slice(0, 16),
  });
}

export async function maintain(raw: z.infer<typeof maintenanceTarget>) {
  const input = maintenanceTarget.parse(raw);
  const env = maintenanceEnvironment(input);

  if (input.action === "inspect") return sourceInfo(input.argument);
  const executable = input.cliPath || process.env.BB_CLI;

  if (!executable || !isAbsolute(executable))
    throw new Error("Set the profile's absolute BB CLI path on this machine.");
  const args = maintenanceArguments(input.action, input.argument);

  // Each loopback server authenticates from its own data directory. No remote account credentials are forwarded.
  try {
    const identity = await exec(executable, ["status", "--json"], {
      env,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });

    const { dataDir: actual } = z
      .object({ dataDir: z.string() })
      .parse(JSON.parse(identity.stdout));

    if ((await realpath(actual)) !== (await realpath(env.BB_DATA_DIR!)))
      throw new Error("The loopback address belongs to a different profile data directory.");

    const result = await exec(executable, args, {
      env,
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
    });

    return input.action === "list" ? result.stdout : "";
  } catch {
    throw new Error(
      `Plugin ${input.action} failed on the selected machine; inspect its local plugin logs.`,
    );
  }
}
