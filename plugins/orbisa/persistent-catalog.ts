import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { discoverCatalog } from "./task-catalog.ts";
import { withGitBundle } from "./task-git-cache.ts";
import { CHECKOUT_SCRIPT } from "./task-checkout.ts";
import { checked } from "./task-process.ts";
import { foreign, parse } from "./persistent-effects.ts";
import type { PersistentResource } from "./persistent-resource.ts";

export const WORKSPACE = "/workspace/180seg";
export const seedPersistentCatalog = Effect.fn("Persistent.seedCatalog")(function* (
  resource: PersistentResource,
  cache: string,
  report: (message: string) => void,
) {
  const user = process.env.ORBISA_REMOTE_USER ?? "lucas_netto";
  yield* parse(() => {
    if (!/^[a-z_][a-z0-9_-]*$/.test(user)) throw new Error();
  });
  const root = join(homedir(), "Developer/180seg");
  const run = (args: string[]) => ["orbctl", "run", "-m", resource.name, "-u", user, ...args];
  const repositories = yield* foreign("Could not discover the 180seg repositories.", (signal) =>
    discoverCatalog(root, signal),
  );
  for (const repository of repositories) {
    report(`Preparing ${repository.relative} from committed local Git history`);
    yield* foreign(`Could not seed ${repository.relative}.`, (signal) =>
      withGitBundle(cache, repository.source, signal, (bundle, defaultBranch) =>
        checked(
          run([
            "python3",
            "-c",
            CHECKOUT_SCRIPT,
            JSON.stringify({
              path: `${WORKSPACE}/${repository.relative}`,
              remote: repository.remote,
              key: `${resource.key}/${repository.relative}`,
              defaultBranch,
            }),
          ]),
          { signal, timeoutMs: 300_000, stdinFile: bundle },
        ),
      ),
    );
  }
  for (const [source, filename] of [
    ["orbisa-agents.md", "AGENTS.md"],
    ["orbisa-topology.md", "VM-TOPOLOGY.md"],
  ]) {
    const contents = yield* foreign("Could not read VM workspace instructions.", () =>
      readFile(join(homedir(), ".local/libexec", source), "utf8"),
    );
    yield* foreign("Could not install VM workspace instructions.", (signal) =>
      checked(
        run([
          "python3",
          "-c",
          "import pathlib,sys; pathlib.Path(sys.argv[1]).write_text(sys.stdin.read())",
          `${WORKSPACE}/${filename}`,
        ]),
        { signal, stdin: contents },
      ),
    );
  }
});
