import { useEffect, useState } from "react";
import { Markdown, useRpc } from "@get-bb/plugin-sdk/app";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import type {
  workspaceRpcContract,
  Overview,
  WorkspaceAction,
  PrStack,
  StackHeads,
} from "../../shared/workspace-contract";
import type { WorkspaceData } from "./useWorkspaceData";
import { Avatar, Label, PrGlyph } from "./presentation";

export type DialogAction =
  | "merge"
  | "auto-merge"
  | "update-branch"
  | "rebase-stack"
  | "edit"
  | "labels"
  | "reviewers"
  | "close"
  | "reopen"
  | "ready"
  | "draft"
  | "disable-auto-merge"
  | "checkout";
export function expectedStack(
  stack: PrStack | null,
  number: number,
  whole = false,
): StackHeads | null {
  if (!stack) return null;
  const index = stack.layers.findIndex((pr) => pr.number === number);
  const layers = (whole ? stack.layers : stack.layers.slice(0, index + 1)).filter(
    (pr) => pr.state !== "MERGED",
  );
  if (index < 0 || layers.some((pr) => !pr.headRefOid))
    throw new Error("Stack revisions are unavailable. Refresh before trying again.");
  return {
    number: stack.number,
    base: stack.base,
    heads: layers.map((pr) => ({ number: pr.number, headRefOid: pr.headRefOid! })),
  };
}
const TITLES: Record<DialogAction, string> = {
  merge: "Merge pull request",
  "auto-merge": "Enable auto-merge",
  "update-branch": "Update branch",
  "rebase-stack": "Rebase stack",
  edit: "Edit pull request",
  labels: "Labels",
  reviewers: "Request reviewers",
  close: "Close pull request",
  reopen: "Reopen pull request",
  ready: "Ready for review",
  draft: "Convert to draft",
  "disable-auto-merge": "Disable auto-merge",
  checkout: "Check out pull request",
};
export function ActionDialog({
  action,
  data,
  detail,
  threadId,
  onClose,
}: {
  action: DialogAction;
  data: WorkspaceData;
  detail: Overview;
  threadId: string | null;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof workspaceRpcContract>();
  const [snapshot] = useState(detail);
  const [confirmedStack] = useState(data.stack);
  const [updateMethod, setUpdateMethod] = useState<"merge" | "rebase">("merge");
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">(
    detail.mergeMethods.includes("squash") ? "squash" : (detail.mergeMethods[0] ?? "merge"),
  );
  const [title, setTitle] = useState(detail.title);
  const [body, setBody] = useState(detail.body);
  const [preview, setPreview] = useState(false);
  const [labels, setLabels] = useState(detail.labels.map((label) => label.name));
  const [users, setUsers] = useState<string[]>([]);
  const [teams, setTeams] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<{
    labels: { name: string; color: string }[];
    users: { login: string; avatarUrl: string | null }[];
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (action !== "labels" && action !== "reviewers") return;
    let disposed = false;
    rpc.call("prCandidates", { threadId, url: detail.url }).then(
      (value) => {
        if (!disposed) setCandidates(value);
      },
      (reason) => {
        if (!disposed) setError(String(reason));
      },
    );
    return () => {
      disposed = true;
    };
  }, [rpc, threadId, detail.url, action]);
  const stack = confirmedStack;
  const merging = action === "merge" || action === "auto-merge";
  const layers = stack
    ? (action === "rebase-stack"
        ? stack.layers
        : stack.layers.slice(0, stack.layers.findIndex((pr) => pr.number === detail.number) + 1)
      ).filter((pr) => pr.state !== "MERGED")
    : [];
  const submit = async () => {
    setError("");
    let request: WorkspaceAction;
    try {
      if (merging)
        request = {
          kind: "merge",
          method,
          auto: action === "auto-merge",
          stack: expectedStack(stack, detail.number),
        };
      else if (action === "update-branch" || action === "rebase-stack")
        request = {
          kind: "update-branch",
          method: action === "rebase-stack" ? "rebase" : updateMethod,
          stack: expectedStack(stack, detail.number, true),
        };
      else if (action === "edit")
        request = { kind: "edit", title, body, updatedAt: snapshot.updatedAt };
      else if (action === "labels")
        request = { kind: "labels", labels, updatedAt: snapshot.updatedAt };
      else if (action === "reviewers")
        request = {
          kind: "reviewers",
          users,
          teams: teams
            .split(",")
            .map((team) => team.trim())
            .filter(Boolean),
          remove: false,
        };
      else request = { kind: action };
      if (await data.mutate(request, { head: snapshot.headRefOid, base: snapshot.baseRefName }))
        onClose();
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !data.busy) onClose();
      }}
    >
      <DialogContent className="pr-action-dialog">
        <DialogHeader>
          <DialogTitle>
            {stack && merging ? `Merge ${layers.length} pull requests` : TITLES[action]}
          </DialogTitle>
          <DialogDescription>
            {detail.repository} #{detail.number}
          </DialogDescription>
        </DialogHeader>
        <form
          className="pr-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {merging ? (
            <>
              <p>
                {stack
                  ? `These layers will merge into ${stack.base}, from bottom to top.`
                  : `Merge ${detail.headRefName} into ${detail.baseRefName}.`}
              </p>
              {stack && (
                <div className="pr-confirm-layers">
                  {layers.map((layer) => (
                    <div key={layer.number}>
                      <PrGlyph draft={layer.isDraft} state={layer.state} />
                      <span>
                        #{layer.number} {layer.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <label>
                Merge method
                <select
                  className="pr-text-input"
                  value={method}
                  onChange={(event) => setMethod(event.target.value as typeof method)}
                >
                  {detail.mergeMethods.map((value) => (
                    <option key={value} value={value}>
                      {value === "squash"
                        ? "Squash and merge"
                        : value === "rebase"
                          ? "Rebase and merge"
                          : "Create a merge commit"}
                    </option>
                  ))}
                </select>
              </label>
              {action === "auto-merge" && (
                <p className="pr-muted">GitHub will merge when required checks and reviews pass.</p>
              )}
            </>
          ) : null}
          {(action === "update-branch" || action === "rebase-stack") && (
            <p>
              {stack
                ? `Rebase all ${layers.length} open layers onto ${stack.base}. GitHub updates each branch from bottom to top.`
                : `Bring changes from ${detail.baseRefName} into ${detail.headRefName}.`}
            </p>
          )}
          {action === "update-branch" && !stack && (
            <label>
              Update method
              <select
                className="pr-text-input"
                value={updateMethod}
                onChange={(event) => setUpdateMethod(event.target.value as "merge" | "rebase")}
              >
                <option value="merge">Merge base branch</option>
                <option value="rebase">Rebase onto base branch</option>
              </select>
            </label>
          )}
          {action === "close" && <p>Close “{detail.title}” without merging its changes.</p>}
          {action === "ready" && <p>Mark this draft ready for review.</p>}
          {action === "draft" && <p>Mark this pull request as a work in progress.</p>}
          {action === "reopen" && <p>Reopen “{detail.title}”.</p>}
          {action === "disable-auto-merge" && (
            <p>Remove the instruction to merge when requirements pass.</p>
          )}
          {action === "checkout" && (
            <p>
              Check out {detail.headRefName} in <code>{detail.checkoutRoot}</code>.
            </p>
          )}
          {action === "edit" && (
            <>
              <label>
                Title
                <input
                  className="pr-text-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className="pr-editor-tabs">
                <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
                  Write
                </button>
                <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
                  Preview
                </button>
              </div>
              {preview ? (
                <Markdown content={body} className="pr-markdown pr-editor-preview" />
              ) : (
                <textarea
                  className="pr-text-input pr-body-input"
                  aria-label="Description"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              )}
            </>
          )}
          {(action === "labels" || action === "reviewers") && (
            <>
              <input
                className="pr-text-input"
                type="search"
                placeholder={action === "labels" ? "Search labels" : "Search reviewers"}
                aria-label={action === "labels" ? "Search labels" : "Search reviewers"}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="pr-candidate-list">
                {!candidates && !error ? (
                  <p>Loading…</p>
                ) : action === "labels" ? (
                  (candidates?.labels ?? [])
                    .filter((label) => label.name.toLowerCase().includes(query.toLowerCase()))
                    .map((label) => (
                      <label key={label.name}>
                        <input
                          type="checkbox"
                          checked={labels.includes(label.name)}
                          onChange={(event) =>
                            setLabels((current) =>
                              event.target.checked
                                ? [...current, label.name]
                                : current.filter((name) => name !== label.name),
                            )
                          }
                        />
                        <Label {...label} />
                      </label>
                    ))
                ) : (
                  (candidates?.users ?? [])
                    .filter(
                      (user) =>
                        user.login !== detail.author?.login &&
                        user.login.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((user) => (
                      <label key={user.login}>
                        <input
                          type="checkbox"
                          checked={users.includes(user.login)}
                          onChange={(event) =>
                            setUsers((current) =>
                              event.target.checked
                                ? [...current, user.login]
                                : current.filter((login) => login !== user.login),
                            )
                          }
                        />
                        <Avatar actor={user} />
                        {user.login}
                      </label>
                    ))
                )}
              </div>
              {action === "reviewers" && (
                <label>
                  Teams
                  <input
                    className="pr-text-input"
                    placeholder="Team slugs, separated by commas"
                    value={teams}
                    onChange={(event) => setTeams(event.target.value)}
                  />
                </label>
              )}
            </>
          )}
          {(error || data.error) && (
            <p className="pr-failure" role="alert">
              {error || data.error}
            </p>
          )}
          <div className="pr-dialog-footer">
            <button type="button" className="pr-control" disabled={data.busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="pr-control pr-primary"
              disabled={
                data.busy ||
                (merging &&
                  (!data.stackLoaded ||
                    !!data.stackError ||
                    layers.some((layer) => layer.isDraft))) ||
                (action === "edit" && !title.trim()) ||
                (action === "reviewers" && !users.length && !teams.trim())
              }
            >
              {data.busy
                ? "Working…"
                : action === "edit" || action === "labels"
                  ? "Save changes"
                  : stack && merging
                    ? `Merge ${layers.length} pull requests`
                    : TITLES[action]}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
