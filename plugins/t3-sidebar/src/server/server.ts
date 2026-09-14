import { createRenameHandlers } from "./lib/rename";
import { createSnoozeHandlers } from "./lib/snooze";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { Effect } from "effect";
import { call, sync, createRuntime } from "./lib/server-effects";
import { createProjectSettingsHandlers, registerProjectAutoPull } from "./lib/project-settings";
import { createProjectThreadHandlers } from "./lib/project-thread-create";
import { createSideThreadHandlers } from "./lib/side-thread";

import { createSettledHandlers } from "./lib/settled";
import { rpcContract } from "../shared/rpc-contract";

export default function plugin(bb: BbPluginApi) {
  const runtime = createRuntime(bb);
  bb.rpc.register(rpcContract, {
    ...createSnoozeHandlers(bb),
    ...createRenameHandlers(bb),
    ...createProjectSettingsHandlers(bb),
    ...createProjectThreadHandlers(bb),
    ...createSideThreadHandlers(bb),
    project_hosts: () =>
      runtime.runPromise(
        call("hosts.list", () => bb.sdk.hosts.list()).pipe(
          Effect.map((hosts) =>
            hosts
              .filter((host) => host.status === "connected")
              .map(({ id, name }) => ({ id, name })),
          ),
        ),
      ),
    project_directory: (input) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const listing = yield* call("hosts.directory", () => bb.sdk.hosts.directory(input));

          return {
            directory: listing.directory,
            parent: listing.parent,
            entries: listing.entries
              .filter((entry) => entry.kind === "directory")
              .map(({ name, path }) => ({ name, path }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          };
        }),
      ),
    project_create: ({ hostId, path }) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const name =
            path
              .replace(/[\\/]+$/u, "")
              .split(/[\\/]/u)
              .at(-1) || "Root";

          const project = yield* call("projects.create", () =>
            bb.sdk.projects.create({
              name,
              source: { type: "local_path", hostId, path },
            }),
          );

          return { id: project.id };
        }),
      ),
    project_remove: ({ projectId }) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const projects = yield* call("projects.list", () =>
            bb.sdk.projects.list({ includePersonal: true }),
          );

          const project = projects.find((item) => item.id === projectId);

          if (!project || project.kind === "personal")
            return yield* sync("projects.remove", () => {
              throw new Error("This project cannot be removed");
            });
          yield* call("projects.delete", () => bb.sdk.projects.delete({ projectId }));

          return null;
        }),
      ),
    ...createSettledHandlers(bb),
  });

  registerProjectAutoPull(bb);

  return runtime.runPromise(sync("log.loaded", () => bb.log.info("loaded")));
}
