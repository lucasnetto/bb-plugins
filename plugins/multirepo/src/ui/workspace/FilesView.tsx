import { useCallback, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { useLoad } from "../hooks/useLoad";
import { Blank, Loading, ErrorMessage } from "../components/LoadState";
import {
  useRpc,
  experimental_Diff as Diff,
  experimental_SourceCode as SourceCode,
  experimental_FileLink as FileLink,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, Change, Detail } from "../../shared/contract";

function FilePreview({
  repo,
  path,
  mode,
  hostId,
  root,
  revision,
}: {
  repo: string;
  path: string;
  mode: "staged" | "worktree" | "source";
  hostId: string;
  root: string;
  revision: number;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(() => rpc.call("detail", { repo, path, mode }), [rpc, repo, path, mode]);
  const state = useLoad<Detail>(load, revision);
  const [view, setView] = useState<"unified" | "split">("unified");
  return (
    <section className="min-w-0 flex-1 overflow-auto" aria-label="File preview">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <span className="break-all font-mono text-xs">{path}</span>
        <div className="flex items-center gap-3">
          {mode !== "source" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setView((v) => (v === "split" ? "unified" : "split"))}
            >
              {view === "split" ? "Unified diff" : "Split diff"}
            </Button>
          ) : null}
          <FileLink
            target={{ kind: "host", hostId, path: `${root}/${repo}/${path}` }}
            className="text-sm underline"
          >
            Open file
          </FileLink>
        </div>
      </div>
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorMessage message={state.error} />
      ) : state.data ? (
        <>
          {state.data.notice ? <Blank title={state.data.notice} /> : null}
          {state.data.patch ? <Diff patch={state.data.patch} path={path} view={view} /> : null}
          {state.data.content !== null ? (
            <SourceCode content={state.data.content} path={path} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
export function FilesView({
  repo,
  mode,
  root,
  hostId,
  revision,
}: {
  repo: string;
  mode: "changes" | "files";
  root: string;
  hostId: string;
  revision: number;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    path: string;
    mode: "staged" | "worktree" | "source";
  } | null>(null);
  const load = useCallback(
    async () =>
      mode === "changes"
        ? {
            changes: await rpc.call("changes", { repo }),
            files: [] as string[],
          }
        : { changes: [] as Change[], files: await rpc.call("files", { repo }) },
    [rpc, repo, mode],
  );
  const state = useLoad(load, revision);
  const matches = (path: string) => path.toLowerCase().includes(query.toLowerCase());
  function entry(path: string, label: string, fileMode: "staged" | "worktree" | "source") {
    return (
      <button
        key={`${fileMode}:${path}`}
        className={cn(
          "flex w-full items-start gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent focus-visible:outline focus-visible:outline-ring",
          selected?.path === path && selected.mode === fileMode && "bg-accent",
        )}
        onClick={() => setSelected({ path, mode: fileMode })}
      >
        <span className="w-4 shrink-0 text-muted-foreground">{label}</span>
        <span className="break-all font-mono">{path}</span>
      </button>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="max-h-72 shrink-0 overflow-auto border-b border-border p-3 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
        <Input
          aria-label="Filter files"
          placeholder="Filter files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {state.loading ? (
          <Loading />
        ) : state.error ? (
          <ErrorMessage message={state.error} />
        ) : state.data ? (
          <div className="mt-3">
            {mode === "files" ? (
              state.data.files.filter(matches).map((path) => entry(path, "", "source"))
            ) : (
              <>
                <p className="py-2 text-xs font-medium text-muted-foreground">Staged</p>
                {state.data.changes
                  .filter((c) => c.index !== " " && c.index !== "?")
                  .filter((c) => matches(c.path))
                  .map((c) => entry(c.path, c.index, "staged"))}
                <p className="py-2 text-xs font-medium text-muted-foreground">Working tree</p>
                {state.data.changes
                  .filter((c) => c.worktree !== " ")
                  .filter((c) => matches(c.path))
                  .map((c) => entry(c.path, c.worktree, c.index === "?" ? "source" : "worktree"))}
                {state.data.changes.length === 0 ? <Blank title="Working tree clean" /> : null}
              </>
            )}
          </div>
        ) : null}
      </div>
      {selected ? (
        <FilePreview {...selected} repo={repo} root={root} hostId={hostId} revision={revision} />
      ) : (
        <Blank
          title="Select a file"
          description={
            mode === "changes"
              ? "Choose a staged or working-tree change to inspect."
              : "Tracked and untracked files are listed; ignored files are excluded."
          }
        />
      )}
    </div>
  );
}
