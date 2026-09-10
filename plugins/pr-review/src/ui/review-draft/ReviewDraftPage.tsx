import { useEffect, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useAppPanel,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../shared/contract";
import { parsePrUrl } from "../../shared/links-contract";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { DraftPrReview } from "../review/PrReview";
import { ReviewCommentBody } from "../review/ReviewCommentBody";
import { useDraftComments } from "./comments";
import { draftUrl, draftPath, reviewDraftTab } from "./navigation";

export function ReviewDraftPage({ subPath }: PluginNavPanelProps) {
  const url = draftUrl(subPath);
  const navigate = useBbNavigate();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  if (url) return <ReviewConversation key={url} url={url} />;
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Review a pull request</h1>
      <p className="text-sm text-muted-foreground">
        Read the diff and collect comments, then send a message to start a conversation.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            navigate.toPluginPanel("review", {
              subPath: draftPath(input),
            });
          } catch (reason) {
            setError(String(reason));
          }
        }}
      >
        <label htmlFor="review-pr-url" className="text-sm">
          GitHub pull request URL
        </label>
        <Input
          id="review-pr-url"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="https://github.com/owner/repo/pull/123"
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit">Open review</Button>
      </form>
    </section>
  );
}
function ReviewConversation({ url }: { url: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const panel = experimental_useAppPanel();
  const draft = useDraftComments(url);
  const [defaults, setDefaults] = useState<{ projectId: string; hostId: string } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [initialPrompt] = useState(() => {
    try {
      const key = `pr-review:initial-prompt:${url}`;
      const prompt = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      return prompt ?? undefined;
    } catch {
      return undefined;
    }
  });
  const ref = parsePrUrl(url);
  useEffect(() => {
    panel.openFixedTab({ surface: { kind: "current" }, tab: reviewDraftTab });
  }, [panel, url]);
  useEffect(() => {
    let disposed = false;
    setError("");
    rpc.call("reviewDraftDefaults", null).then(
      (value) => {
        if (!disposed) setDefaults(value);
      },
      (reason) => {
        if (!disposed) setError(String(reason));
      },
    );
    return () => {
      disposed = true;
    };
  }, [rpc, retry]);
  async function submit(request: NewThreadRequest) {
    if (draft.error) throw new Error(draft.error);
    const submitted = draft.comments;
    const opened = await rpc.call("startReview", { url, request, comments: submitted });
    // These are local draft operations after a successful create. Never make a
    // storage failure look like a failed Send, which could create another thread.
    try {
      draft.remove(submitted.map((comment) => comment.id));
    } catch {
      toast.error("Thread created, but the saved comments could not be cleared.");
    }
    try {
      sessionStorage.setItem(`bb:pr-review:open-review:${opened.threadId}`, url);
    } catch {
      toast.error("Open this PR from the thread’s Linked PRs panel.");
    }
    if (opened.warning) toast.error(opened.warning);
    navigate.toThread(opened.threadId);
  }
  return (
    <section aria-label="PR review conversation" className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-2 border-b border-border p-4">
        <h1 className="text-base font-semibold">
          {ref.repository} #{ref.number}
        </h1>
        <p className="text-sm text-muted-foreground">
          Review the PR and add comments. Your first message starts the thread.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => panel.openFixedTab({ surface: { kind: "current" }, tab: reviewDraftTab })}
        >
          Open PR panel
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {draft.comments.length ? (
          <ol aria-label="Draft review comments" className="flex flex-col gap-3 p-4">
            {draft.comments.map((comment) => (
              <li
                key={comment.id}
                className="flex flex-col gap-2 rounded-md border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground" title={comment.label}>
                    {comment.label}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove comment on ${comment.label}`}
                    onClick={() => draft.remove([comment.id])}
                  >
                    Remove
                  </Button>
                </div>
                <ReviewCommentBody content={comment.text} />
              </li>
            ))}
          </ol>
        ) : null}
        {draft.error ? (
          <div role="alert" className="p-4 text-sm text-destructive">
            {draft.error}{" "}
            <Button variant="outline" size="sm" onClick={draft.clear}>
              Clear saved comments
            </Button>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="p-4 text-sm text-destructive">
            {error}{" "}
            <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
              Retry
            </Button>
          </div>
        ) : null}
        {defaults ? (
          <NewThreadComposer
            defaultProjectId={defaults.projectId}
            defaultEnvironment={{
              type: "host",
              hostId: defaults.hostId,
              workspace: { type: "personal" },
            }}
            draftKey={`pr-review:review:v1:${url}`}
            initialPrompt={
              initialPrompt ??
              (draft.comments.length ? "Discuss these review comments." : undefined)
            }
            placeholder="Ask about the PR or discuss your comments…"
            layout="document"
            className="mt-auto"
            onSubmit={submit}
          />
        ) : !error ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            Loading composer…
          </p>
        ) : null}
      </div>
    </section>
  );
}
export function ReviewDraftPanel({ subPath }: PluginNavPanelProps) {
  const url = draftUrl(subPath);
  if (!url)
    return (
      <p className="p-4 text-sm text-muted-foreground">Open a pull request to see its diff here.</p>
    );
  return <ReviewDraftCode key={url} url={url} />;
}
function ReviewDraftCode({ url }: { url: string }) {
  const draft = useDraftComments(url);
  return <DraftPrReview url={url} onComment={draft.add} />;
}
