import { Effect } from "effect";
import { command } from "./host-effects";

export function githubRemote(value: string): string | null {
  return (
    value
      .trim()
      .match(
        /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
      )?.[1]
      ?.toLowerCase() ?? null
  );
}

/** Only inspect the thread's checkout; never crawl its parent or home folder. */
export const matchingCheckout = Effect.fn("PrReview.checkout")(
  function* (cwd: string, repository: string) {
    const git = (args: string[]) => command(cwd, "git", ["--no-pager", ...args]);
    const remote = yield* git(["remote", "get-url", "origin"]);

    if (githubRemote(remote) !== repository.toLowerCase()) return null;

    return (yield* git(["rev-parse", "--show-toplevel"])).trim() || null;
  },
  (effect) => effect.pipe(Effect.catchTag("CommandError", () => Effect.succeed(null))),
);
