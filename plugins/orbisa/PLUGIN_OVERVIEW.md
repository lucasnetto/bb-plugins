## Dedicated task machines

Choose **Orbisa task VM** when starting a BB task. Each task gets an isolated
clone of a prepared base with BB, Codex and skills preinstalled and an independent checkout from a cached Git bundle. The Work 180seg catalog
recreates its repository folders from committed local branches and preserves
the parent workspace instructions. Related
threads can share the same machine by reusing its environment.

Task machines stop after 15 idle minutes by default and resume before queued
work runs. Settling the last thread starts a ten-minute deletion countdown.
Un-settle during that window to keep the disk. Once deleted, all remaining
files are discarded and the conversation stays available as history.

## Existing Orbisa slots

Your shared Cursor and T3 Code machines keep their stable identities and
existing wake behavior. Task machines use a separate namespace for each BB
instance. The plugin does not register task VMs in Cursor or alter shared slots.

## Requirements and controls

Requires BB 0.43.0, a macOS server with OrbStack, an isolated clean Orbisa
template, and reachable BB machine enrollment through BB Connect. GitHub and
agent credentials come from the active profile's existing local setup.
VMs consume local disk and compute; this does not provision cloud resources.

Use `bb orbisa tasks` for lifecycle and deletion deadlines. The **Task VM
template** and **Suspend task VMs after idle** settings control provisioning
and idle behavior. Agents discover the focused `orbisa-tasks` skill.
