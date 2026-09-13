import { Match } from "effect";
import { memo } from "react";
import type { PullRequest, PrState } from "../../../contract";
import { Icon } from "../components/ui/icon";
import { Avatar, CheckGlyph, DiffStat, Label, PrGlyph, relativeTime } from "./presentation";

export const PullRequestRow = memo(function PullRequestRow({
  pr,
  selected,
  onSelect,
  state,
}: {
  pr: PullRequest;
  selected: boolean;
  onSelect: (url: string) => void;
  state: PrState;
}) {
  return (
    <a
      href={pr.url}
      aria-current={selected ? "true" : undefined}
      className="pr-row"
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          onSelect(pr.url);
        }
      }}
    >
      <PrGlyph
        draft={pr.isDraft}
        state={Match.value(state).pipe(
          Match.when("merged", () => "MERGED"),
          Match.when("closed", () => "CLOSED"),
          Match.orElse(() => "OPEN"),
        )}
        conflict={pr.mergeable === "CONFLICTING"}
      />
      <span className="pr-row-grid">
        <span className="pr-row-title" title={pr.title}>
          {pr.title}
        </span>
        <span className="pr-row-signals">
          {pr.stack && (
            <span
              className="pr-stack-count"
              title={`Stack #${pr.stack.number}, layer ${pr.stack.position} of ${pr.stack.size}`}
            >
              <Icon name="Layers" className="size-3.5" />
              {pr.stack.position}/{pr.stack.size}
            </span>
          )}
          <CheckGlyph state={pr.checksState} />
        </span>
        <span className="pr-row-meta">
          <span>#{pr.number}</span>
          <span className="pr-meta-separator">·</span>
          <span className="pr-row-repository" title={pr.repository}>
            {pr.repository}
          </span>
          <span className="pr-meta-separator">·</span>
          <span className="pr-row-author">
            <Avatar actor={{ login: pr.author, avatarUrl: pr.avatarUrl ?? null }} />
            <span>{pr.author}</span>
          </span>
          {pr.labels?.length ? (
            <span className="pr-row-labels">
              <Label {...pr.labels[0]!} />
              {pr.labels.length > 1 && <span>+{pr.labels.length - 1}</span>}
            </span>
          ) : null}
          {pr.reviewDecision === "APPROVED" && (
            <span title="Approved" className="pr-success">
              <Icon name="CircleCheck" className="size-3" />
            </span>
          )}
        </span>
        <span className="pr-row-numbers">
          <DiffStat additions={pr.additions} deletions={pr.deletions} />
          <time dateTime={pr.updatedAt} title={new Date(pr.updatedAt).toLocaleString()}>
            {relativeTime(pr.updatedAt)}
          </time>
        </span>
      </span>
    </a>
  );
});
