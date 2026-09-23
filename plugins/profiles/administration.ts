import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { defineSettings } from "./settings.ts";

type Settings = Awaited<ReturnType<ReturnType<typeof defineSettings>["get"]>>;

// A generated snapshot lets the desktop restart helper work while BB is down.
// Settings on the plugin page remain the source of truth; this is not user config.
export async function cacheAdministration(values: Settings) {
  const directory = join(homedir(), ".cache", "bb-profiles");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `${randomUUID()}.json`);

  const snapshot = {
    personalLocalUrl: values.personalLocalUrl,
    workLocalUrl: values.workLocalUrl,
  };

  await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(temporary, join(directory, "administration.json"));
}
