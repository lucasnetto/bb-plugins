import { Match } from "effect";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { UrlLink, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { GithubMarkdown } from "../components/GithubMarkdown";
import { toast } from "sonner";
import type { Timeline, workspaceRpcContract } from "../../shared/workspace-contract";
import { draftPath } from "./navigation";
import { Icon, type IconName } from "../components/ui/icon";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ActionDialog, type DialogAction } from "./ActionDialog";
import { PrMenu, PrMenuItem, PrMenuSeparator } from "./Menu";
import {
  Avatar,
  CheckGlyph,
  DiffStat,
  Label,
  PrGlyph,
  checksSummary,
  relativeTime,
} from "./presentation";
import { useWorkspaceData } from "./useWorkspaceData";
import { timelineCache, workspaceKey } from "./workspace-cache";
import "./workspace.css";

function Section({
  title,
  count,
  children,
  action,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <details className="pr-summary-section" open>
      <summary>
        <span>{title}</span>
        <Icon name="ChevronDown" className="pr-disclosure size-3" />
        {count !== undefined && <span className="pr-muted">{count}</span>}
        {action}
      </summary>
      <div className="pr-section-content">{children}</div>
    </details>
  );
}

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(label);
  } catch {
    toast.error("Could not copy to the clipboard.");
  }
}

export function PullRequestDetail({
  threadId,
  url,
  active = true,
  code,
  linkAction,
}: {
  threadId: string | null;
  url: string;
  active?: boolean;
  code: ReactNode;
  linkAction?: ReactNode;
}) {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof workspaceRpcContract>();
  const data = useWorkspaceData(threadId, url, active);
  const { detail, stack } = data;
  const [tab, setTab] = useState("summary");
  const [codeVisited, setCodeVisited] = useState(false);
  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [timelinePages, setTimelinePages] = useState(1);

  const timelineKey = JSON.stringify([
    workspaceKey(threadId, url),
    detail?.updatedAt,
    timelinePages,
  ]);

  const [timeline, setTimeline] = useState<Timeline | null>(
    () => timelineCache.peek(timelineKey) ?? null,
  );

  const [timelineError, setTimelineError] = useState("");
  const [timelineRetry, setTimelineRetry] = useState(0);
  const previousTimelineRetry = useRef(timelineRetry);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [newestFirst, setNewestFirst] = useState(false);
  const [comment, setComment] = useState("");
  const [commentPreview, setCommentPreview] = useState(false);
  const checks = useRef<HTMLDivElement>(null);
  const tabId = useId();
  useEffect(() => {
    if (!active || !detail) return;
    let disposed = false;
    setTimelineLoading(true);
    const force = timelineRetry !== previousTimelineRetry.current;
    previousTimelineRetry.current = timelineRetry;
    timelineCache
      .read(
        timelineKey,
        async () => {
          const pages = await Promise.all(
            Array.from({ length: timelinePages }, (_, index) =>
              rpc.call("prTimeline", { threadId, url, page: index + 1 }),
            ),
          );

          const last = pages.at(-1)!;

          return {
            ...last,
            entries: [
              ...new Map(
                pages.flatMap((page) => page.entries).map((entry) => [entry.id, entry]),
              ).values(),
            ],
          };
        },
        force,
      )
      .then(
        (value) => {
          if (!disposed) {
            setTimeline(value);
            setTimelineError("");
            setTimelineLoading(false);
          }
        },
        (reason) => {
          if (!disposed) {
            setTimelineError(String(reason));
            setTimelineLoading(false);
          }
        },
      );

    return () => {
      disposed = true;
    };
  }, [
    rpc,
    threadId,
    url,
    data.revision,
    !!detail,
    timelineKey,
    active,
    timelineRetry,
    timelinePages,
  ]);
  const summary = checksSummary(detail?.checks ?? []);

  const changeTab = (value: string) => {
    if (value === "code") setCodeVisited(true);
    setTab(value);
  };

  const openStackPr = (next: string) => navigate.toPluginPanel("prs", { subPath: draftPath(next) });

  const canMerge =
    !!detail &&
    detail.canMerge &&
    detail.state === "OPEN" &&
    !detail.isDraft &&
    detail.mergeable !== "CONFLICTING" &&
    data.stackLoaded &&
    !data.stackError;

  const primary = detail?.state === "CLOSED" ? "reopen" : detail?.isDraft ? "ready" : "merge";
  const disabled = data.busy || !detail || (primary === "merge" ? !canMerge : !detail.canEdit);

  const commentForm = (
    <form
      className="pr-comment-form"
      onSubmit={(event) => {
        event.preventDefault();
        const submitted = comment;
        void data.mutate({ kind: "comment", body: submitted }).then((ok) => {
          if (ok) setComment((current) => (current === submitted ? "" : current));
        });
      }}
    >
      <div className="pr-editor-tabs">
        <button
          type="button"
          aria-pressed={!commentPreview}
          onClick={() => setCommentPreview(false)}
        >
          Write
        </button>
        <button type="button" aria-pressed={commentPreview} onClick={() => setCommentPreview(true)}>
          Preview
        </button>
      </div>
      {commentPreview ? (
        <GithubMarkdown content={comment || "Nothing to preview."} className="pr-editor-preview" />
      ) : (
        <textarea
          className="pr-text-input"
          rows={4}
          aria-label="Write a comment"
          placeholder="Leave a comment…"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
              event.currentTarget.form?.requestSubmit();
          }}
        />
      )}
      <div className="pr-dialog-footer">
        <span className="pr-muted">Markdown supported</span>
        <button
          type="submit"
          className="pr-control pr-primary"
          disabled={!comment.trim() || data.busy}
        >
          {data.busy ? "Posting…" : "Comment"}
        </button>
      </div>
    </form>
  );

  return (
    <section className="pr-detail" aria-label="Pull request">
      <header className="pr-detail-header">
        <div className="pr-detail-topline">
          <UrlLink href={url} className="pr-repository-link">
            {detail?.repository ?? new URL(url).pathname.split("/").slice(1, 3).join("/")} #
            {detail?.number ?? url.split("/").at(-1)}
            <Icon name="ExternalLink" className="size-3" />
          </UrlLink>
          <div className="pr-detail-actions">
            {linkAction}
            <PrMenu label="Check out" icon="GitBranch" disabled={!detail || data.busy}>
              <PrMenuItem
                icon="Copy"
                onSelect={() => void copy(`gh pr checkout ${url}`, "Checkout command copied")}
              >
                Copy checkout command
              </PrMenuItem>
              <PrMenuItem
                icon="GitBranch"
                disabled={!detail?.checkoutRoot}
                onSelect={() => setDialog("checkout")}
              >
                Check out in this environment
              </PrMenuItem>
            </PrMenu>
            {detail?.state !== "MERGED" && (
              <button
                className={`pr-control pr-header-primary ${primary === "merge" ? "pr-merge-button" : ""}`}
                disabled={disabled}
                onClick={() => setDialog(primary)}
              >
                <Icon
                  name={Match.value(primary).pipe(
                    Match.when("merge", (): IconName => "GitMerge"),
                    Match.when("ready", (): IconName => "GitPullRequest"),
                    Match.when("reopen", (): IconName => "RotateCcw"),
                    Match.exhaustive,
                  )}
                  className="size-3.5"
                />
                {Match.value(primary).pipe(
                  Match.when("merge", () => "Merge"),
                  Match.when("ready", () => "Ready for review"),
                  Match.when("reopen", () => "Reopen"),
                  Match.exhaustive,
                )}
              </button>
            )}
            <PrMenu label="Pull request actions" icon="MoreHorizontal" compact disabled={!detail}>
              <PrMenuItem icon="ExternalLink" onSelect={() => navigate.openUrl(url)}>
                Open on GitHub
              </PrMenuItem>
              <PrMenuItem icon="Copy" onSelect={() => void copy(url, "Pull request URL copied")}>
                Copy link
              </PrMenuItem>
              <PrMenuItem
                icon="ArrowReloadHorizontal"
                disabled={data.loading}
                onSelect={() => {
                  void data.refresh();
                  setTimelineRetry((value) => value + 1);
                }}
              >
                Refresh
              </PrMenuItem>
              <PrMenuSeparator />
              {detail?.canEdit && (
                <PrMenuItem icon="Edit" onSelect={() => setDialog("edit")}>
                  Edit title and description
                </PrMenuItem>
              )}
              {detail?.state === "OPEN" && (
                <>
                  <PrMenuItem
                    icon="GitBranch"
                    disabled={!detail.canUpdateBranch || !!stack || data.busy}
                    onSelect={() => setDialog("update-branch")}
                  >
                    Update branch
                  </PrMenuItem>
                  {stack && (
                    <PrMenuItem
                      icon="Layers"
                      disabled={
                        data.busy ||
                        !data.stackLoaded ||
                        stack.layers.at(-1)?.number !== detail.number
                      }
                      onSelect={() => setDialog("rebase-stack")}
                    >
                      Rebase stack
                    </PrMenuItem>
                  )}
                  {detail.autoMerge ? (
                    <PrMenuItem
                      disabled={data.busy}
                      onSelect={() => setDialog("disable-auto-merge")}
                    >
                      Disable auto-merge
                    </PrMenuItem>
                  ) : (
                    <PrMenuItem
                      disabled={!canMerge || !detail.autoMergeAllowed || !!stack || data.busy}
                      onSelect={() => setDialog("auto-merge")}
                    >
                      Enable auto-merge
                    </PrMenuItem>
                  )}
                  <PrMenuItem
                    icon="GitPullRequestDraft"
                    disabled={!detail.canEdit || data.busy}
                    onSelect={() => setDialog(detail.isDraft ? "ready" : "draft")}
                  >
                    {detail.isDraft ? "Mark ready for review" : "Convert to draft"}
                  </PrMenuItem>
                  <PrMenuSeparator />
                  <PrMenuItem
                    icon="GitPullRequestClosed"
                    danger
                    disabled={!detail.canEdit || data.busy}
                    onSelect={() => setDialog("close")}
                  >
                    Close pull request
                  </PrMenuItem>
                </>
              )}
            </PrMenu>
          </div>
        </div>
        <div className="pr-title-line">
          <h2 title={detail?.title}>{detail?.title ?? "Loading pull request…"}</h2>
          {detail?.canEdit && (
            <button
              className="pr-icon-button pr-edit-title"
              aria-label="Edit title and description"
              onClick={() => setDialog("edit")}
            >
              <Icon name="Edit" className="size-3" />
            </button>
          )}
        </div>
        {detail && (
          <>
            <div className="pr-author-line">
              <Avatar actor={detail.author} />
              <span>{detail.author?.login ?? "ghost"}</span>
              <span>·</span>
              <span>updated {relativeTime(detail.updatedAt)}</span>
              {detail.isDraft && <span className="pr-small-badge">Draft</span>}
              {detail.state !== "OPEN" && <PrGlyph state={detail.state} />}
              <button
                className="pr-checkout-copy"
                onClick={() =>
                  void copy(
                    `gh pr checkout ${detail.number} --repo ${detail.repository}`,
                    "Checkout command copied",
                  )
                }
                title="Copy checkout command"
              >
                gh pr checkout {detail.number}
              </button>
            </div>
            <div className="pr-branch-line">
              <span className="pr-branches">
                <Icon name={stack ? "Layers" : "GitBranch"} className="size-3.5" />
                <code title={detail.baseRefName}>{detail.baseRefName}</code>
                <span aria-label="Base branch">←</span>
                <button
                  title="Copy branch name"
                  onClick={() => void copy(detail.headRefName, "Branch name copied")}
                >
                  <code>{detail.headRefName}</code>
                </button>
              </span>
              <span className="pr-file-stats">
                <Icon name="FileDiff" className="size-3.5" />
                {detail.changedFiles} {detail.changedFiles === 1 ? "file" : "files"}{" "}
                <DiffStat additions={detail.additions} deletions={detail.deletions} />
              </span>
            </div>
          </>
        )}
      </header>
      <div className="pr-detail-tabbar">
        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList className="pr-segmented">
            <TabsTrigger
              value="summary"
              id={`${tabId}-summary`}
              aria-controls={`${tabId}-summary-panel`}
            >
              Summary
            </TabsTrigger>
            <TabsTrigger
              value="timeline"
              id={`${tabId}-timeline`}
              aria-controls={`${tabId}-timeline-panel`}
            >
              Timeline
            </TabsTrigger>
            <TabsTrigger value="code" id={`${tabId}-code`} aria-controls={`${tabId}-code-panel`}>
              Code
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <button
          className="pr-check-summary"
          title="Show checks"
          onClick={() => {
            changeTab("summary");
            requestAnimationFrame(() =>
              checks.current?.scrollIntoView({ block: "start", behavior: "instant" }),
            );
          }}
        >
          <CheckGlyph state={summary.state} />
          <span>{summary.label}</span>
        </button>
      </div>
      {data.error && (
        <div className="pr-inline-error" role="alert">
          {data.error}
          <button className="pr-control" onClick={() => void data.refresh()}>
            Retry
          </button>
        </div>
      )}
      {data.stackError && (
        <div className="pr-inline-error" role="alert">
          Stack information unavailable. {data.stackError}
          <button className="pr-control" onClick={() => void data.refresh()}>
            Retry
          </button>
        </div>
      )}
      {data.pending && (
        <div className="pr-list-notice" role="status">
          GitHub is merging the stack… <UrlLink href={url}>View on GitHub</UrlLink>
        </div>
      )}
      <div
        className="pr-tab-panel pr-summary-scroll"
        hidden={tab !== "summary"}
        role="tabpanel"
        id={`${tabId}-summary-panel`}
        aria-labelledby={`${tabId}-summary`}
      >
        {detail ? (
          <>
            <div className="pr-summary-metadata">
              <div>
                <span>
                  <Icon name="UserRound" className="size-3.5" />
                  Reviewers
                </span>
                <span>
                  {detail.reviewers.length ? (
                    detail.reviewers.map((reviewer) => (
                      <span className="pr-reviewer" key={`${reviewer.kind}:${reviewer.login}`}>
                        {reviewer.login}
                        {detail.canEdit && (
                          <button
                            className="pr-icon-button"
                            aria-label={`Remove review request for ${reviewer.login}`}
                            disabled={data.busy}
                            onClick={() =>
                              void data.mutate({
                                kind: "reviewers",
                                users: reviewer.kind === "user" ? [reviewer.login] : [],
                                teams: reviewer.kind === "team" ? [reviewer.login] : [],
                                remove: true,
                              })
                            }
                          >
                            <Icon name="X" className="size-3" />
                          </button>
                        )}
                      </span>
                    ))
                  ) : (
                    <span className="pr-muted">None</span>
                  )}
                  {detail.canEdit && (
                    <button
                      className="pr-icon-button"
                      aria-label="Request reviewers"
                      onClick={() => setDialog("reviewers")}
                    >
                      <Icon name="UserRoundPlus" className="size-3.5" />
                    </button>
                  )}
                </span>
              </div>
              <div>
                <span>
                  <Icon name="Tag" className="size-3.5" />
                  Labels
                </span>
                <span>
                  {detail.labels.length ? (
                    detail.labels.map((label) => <Label key={label.name} {...label} />)
                  ) : (
                    <span className="pr-muted">None</span>
                  )}
                  {detail.canEdit && (
                    <button
                      className="pr-icon-button"
                      aria-label="Edit labels"
                      onClick={() => setDialog("labels")}
                    >
                      <Icon name="Tag" className="size-3.5" />
                    </button>
                  )}
                </span>
              </div>
              <div>
                <span>
                  <Icon name="MessageSquare" className="size-3.5" />
                  Comments
                </span>
                <button className="pr-text-button" onClick={() => changeTab("timeline")}>
                  {detail.commentCount} {detail.commentCount === 1 ? "comment" : "comments"}
                </button>
              </div>
            </div>
            {stack && (
              <Section title="Stack" count={stack.layers.length}>
                <div className="pr-stack-list">
                  {[...stack.layers].reverse().map((layer, index) => (
                    <button
                      key={layer.number}
                      className={`pr-stack-layer ${layer.number === detail.number ? "pr-stack-selected" : ""}`}
                      onClick={() => openStackPr(layer.url)}
                    >
                      <PrGlyph state={layer.state} draft={layer.isDraft} />
                      <span>
                        <strong>#{layer.number}</strong> {layer.title}
                      </span>
                      <span className="pr-muted">
                        {stack.layers.length - index}/{stack.layers.length}
                      </span>
                    </button>
                  ))}
                  <div className="pr-stack-base">
                    <Icon name="GitBranch" className="size-3.5" />
                    {stack.base}
                  </div>
                </div>
              </Section>
            )}
            <Section
              title="Description"
              action={
                detail.canEdit && (
                  <button
                    className="pr-icon-button pr-section-edit"
                    aria-label="Edit description"
                    onClick={(event) => {
                      event.preventDefault();
                      setDialog("edit");
                    }}
                  >
                    <Icon name="Edit" className="size-3" />
                  </button>
                )
              }
            >
              <GithubMarkdown
                content={detail.body.trim() ? detail.body : "_No description provided._"}
              />
            </Section>
            <div ref={checks}>
              <Section title="Checks" count={detail.checks.length}>
                {detail.checks.length ? (
                  detail.checks.map((check, index) => (
                    <div className="pr-check-row" key={`${index}:${check.name}`}>
                      <CheckGlyph state={check.state} />
                      {check.url ? (
                        <UrlLink href={check.url}>{check.name}</UrlLink>
                      ) : (
                        <span>{check.name}</span>
                      )}
                      <span className="pr-check-status">
                        {Match.value(check.state).pipe(
                          Match.when("success", () => "Passed"),
                          Match.when("failure", () => "Failed"),
                          Match.when("skipped", () => "Skipped"),
                          Match.orElse(() => "Pending"),
                        )}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="pr-muted">No checks reported.</p>
                )}
                {detail.checksTruncated && (
                  <p className="pr-muted">
                    Showing the first 100 checks.{" "}
                    <UrlLink href={`${url}/checks`}>View all checks</UrlLink>
                  </p>
                )}
              </Section>
            </div>
            {(detail.mergeable === "CONFLICTING" || detail.mergeStateStatus === "BEHIND") && (
              <Section
                title={
                  detail.mergeable === "CONFLICTING" ? "Merge conflicts" : "Branch out of date"
                }
              >
                <p className="pr-muted">
                  {detail.mergeable === "CONFLICTING"
                    ? "Resolve conflicts before merging this pull request."
                    : `This branch is behind ${detail.baseRefName}.`}
                </p>
                <div className="pr-section-actions">
                  {detail.canUpdateBranch && !stack && (
                    <button
                      className="pr-control"
                      disabled={data.busy}
                      onClick={() => setDialog("update-branch")}
                    >
                      Update branch
                    </button>
                  )}
                </div>
              </Section>
            )}
            <Section title="Conversation" count={detail.commentCount}>
              <ActivityList
                timeline={timeline}
                error={timelineError}
                commentsOnly
                onRetry={() => setTimelineRetry((value) => value + 1)}
                loading={timelineLoading}
                onLoadMore={() => setTimelinePages((value) => value + 1)}
              />
              {commentForm}
            </Section>
          </>
        ) : !data.error ? (
          <div className="pr-detail-skeleton" role="status">
            Loading pull request…
          </div>
        ) : null}
      </div>
      <div
        className="pr-tab-panel pr-timeline-scroll"
        hidden={tab !== "timeline"}
        role="tabpanel"
        id={`${tabId}-timeline-panel`}
        aria-labelledby={`${tabId}-timeline`}
      >
        <div className="pr-timeline-toolbar">
          <span>Activity</span>
          <button className="pr-text-button" onClick={() => setNewestFirst((value) => !value)}>
            <Icon name="ArrowUpDown" className="size-3.5" />
            {newestFirst ? "Newest first" : "Oldest first"}
          </button>
        </div>
        <ActivityList
          timeline={
            timeline
              ? {
                  ...timeline,
                  entries: newestFirst ? [...timeline.entries].reverse() : timeline.entries,
                }
              : null
          }
          error={timelineError}
          onRetry={() => setTimelineRetry((value) => value + 1)}
          loading={timelineLoading}
          onLoadMore={() => setTimelinePages((value) => value + 1)}
        />
        {commentForm}
      </div>
      <div
        className="pr-tab-panel pr-code-panel"
        hidden={tab !== "code"}
        role="tabpanel"
        id={`${tabId}-code-panel`}
        aria-labelledby={`${tabId}-code`}
      >
        {codeVisited && code}
      </div>
      {dialog && detail && (
        <ActionDialog
          key={`${detail.url}:${dialog}`}
          action={dialog}
          detail={detail}
          data={data}
          threadId={threadId}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

function ActivityList({
  timeline,
  error,
  commentsOnly,
  onRetry,
  loading,
  onLoadMore,
}: {
  timeline: Timeline | null;
  error: string;
  commentsOnly?: boolean;
  onRetry: () => void;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const entries =
    timeline?.entries.filter(
      (entry) => !commentsOnly || entry.kind === "comment" || entry.kind === "review",
    ) ?? [];

  return (
    <>
      {error && (
        <div role="alert" className="pr-inline-error">
          {error}
          <button className="pr-control" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {!timeline && !error && (
        <p role="status" className="pr-muted">
          Loading conversation…
        </p>
      )}
      {timeline && !entries.length && (
        <p className="pr-muted">{commentsOnly ? "No comments yet." : "No activity yet."}</p>
      )}
      <ol className="pr-activity">
        {entries.map((entry) => (
          <li key={entry.id} className={`pr-activity-${entry.kind}`}>
            <span className="pr-activity-glyph">
              {entry.kind === "comment" || entry.kind === "review" ? (
                <Avatar actor={entry.author} />
              ) : (
                <Icon
                  name={entry.kind === "commit" ? "GitBranch" : "GitPullRequest"}
                  className="size-3.5"
                />
              )}
            </span>
            <div className="pr-activity-content">
              <div className="pr-activity-meta">
                <strong>{entry.author?.login ?? "GitHub"}</strong>
                <span>{entry.title}</span>
                {entry.url ? (
                  <UrlLink href={entry.url}>
                    <time dateTime={entry.createdAt}>{relativeTime(entry.createdAt)}</time>
                  </UrlLink>
                ) : (
                  <time dateTime={entry.createdAt}>{relativeTime(entry.createdAt)}</time>
                )}
              </div>
              {entry.body && <GithubMarkdown content={entry.body} />}
            </div>
          </li>
        ))}
      </ol>
      {timeline?.nextPage && (
        <button className="pr-control" disabled={loading} onClick={onLoadMore}>
          {loading ? "Loading activity…" : "Load more activity"}
        </button>
      )}
    </>
  );
}
