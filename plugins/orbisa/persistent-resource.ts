import { basename } from "node:path";
import { z } from "zod";
import { taskOwner } from "./task-vms.ts";

export const PERSISTENT_PROVIDER = "orbisa-persistent";

export const PERSISTENT_TEMPLATE = "180seg-orbisa-base";

export const persistentSchema = z.object({
  key: z.string().min(1),
  owner: z.string().min(1),
  slot: z.enum(["01", "02", "03"]),
  name: z.string(),
  vmId: z.string().nullable(),
});

export type PersistentResource = z.infer<typeof persistentSchema>;

export function profileSlots(dataDir: string): readonly PersistentResource["slot"][] {
  if (basename(dataDir) === ".bb-work") return ["01", "02"];

  if (basename(dataDir) === ".bb") return ["01"];
  throw new Error("Persistent slots require the Personal or Work profile.");
}

export function persistentInputs(dataDir: string) {
  return z.object({ slot: z.enum(profileSlots(dataDir)) });
}

export function persistentResource(
  dataDir: string,
  key: string,
  slot: PersistentResource["slot"],
): PersistentResource {
  if (!profileSlots(dataDir).includes(slot))
    throw new Error("This slot belongs to the other profile.");

  return {
    key,
    owner: taskOwner(dataDir),
    slot,
    name: `${basename(dataDir) === ".bb-work" ? "180seg" : "ln"}-orbisa-${slot}`,
    vmId: null,
  };
}

export function ownedPersistentResource(
  dataDir: string,
  value: PersistentResource,
): PersistentResource {
  const resource = persistentSchema.parse(value);
  const expected = persistentResource(dataDir, resource.key, resource.slot);

  if (resource.owner !== expected.owner || resource.name !== expected.name)
    throw new Error("Persistent VM identity belongs to another profile.");

  return resource;
}
