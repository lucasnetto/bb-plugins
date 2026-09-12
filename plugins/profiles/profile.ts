import { basename, normalize } from "node:path";
import type { Profile } from "./contract.ts";

export function resolveProfile(dataDir: string): Profile {
  const name = basename(normalize(dataDir));
  if (name === ".bb") return "personal";
  if (name === ".bb-work") return "work";
  throw new Error("Profiles requires the configured .bb or .bb-work instance directory");
}

export function profileProviderIds(profile: Profile): string[] {
  return profile === "personal"
    ? ["codex", "acp-cursor", "acp-cursor-personal", "cursor-sdk"]
    : ["codex", "acp-cursor", "cursor-sdk"];
}
