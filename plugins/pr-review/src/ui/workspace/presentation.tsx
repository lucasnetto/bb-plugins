import { useState } from "react";
import { Icon } from "../components/ui/icon";
import type { Actor, Check } from "../../shared/workspace-contract";

export function relativeTime(value: string, now = Date.now()) {
  const seconds = Math.max(0, (now - Date.parse(value)) / 1000);

  if (!Number.isFinite(seconds)) return "";

  if (seconds < 60) return "just now";

  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;

  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;

  return `${Math.floor(seconds / 86400)}d ago`;
}

export function Avatar({ actor }: { actor: Actor | null }) {
  const [failed, setFailed] = useState(false);

  return actor?.avatarUrl && !failed ? (
    <img
      className="pr-avatar"
      src={actor.avatarUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="pr-avatar pr-avatar-fallback" aria-hidden="true">
      {(actor?.login ?? "?")[0]?.toUpperCase()}
    </span>
  );
}

export function PrGlyph({
  draft,
  state = "OPEN",
  conflict = false,
}: {
  draft?: boolean;
  state?: string;
  conflict?: boolean;
}) {
  return (
    <span
      className={
        conflict
          ? "pr-failure"
          : state === "MERGED"
            ? "pr-merged"
            : state === "CLOSED"
              ? "pr-failure"
              : draft
                ? "pr-muted"
                : "pr-success"
      }
      title={conflict ? "Merge conflicts" : draft ? "Draft" : state.toLowerCase()}
    >
      <Icon
        name={
          conflict
            ? "AlertTriangle"
            : state === "MERGED"
              ? "GitMerge"
              : state === "CLOSED"
                ? "GitPullRequestClosed"
                : draft
                  ? "GitPullRequestDraft"
                  : "GitPullRequest"
        }
        className="size-4"
      />
      <span className="sr-only">
        {conflict ? "Merge conflicts" : draft ? "Draft" : state.toLowerCase()}
      </span>
    </span>
  );
}

export function CheckGlyph({ state }: { state?: string | null }) {
  if (!state) return null;
  const success = ["success", "SUCCESS"].includes(state);
  const failure = ["failure", "FAILURE", "ERROR"].includes(state);
  const skipped = state === "skipped";

  const label = success
    ? "Checks passing"
    : failure
      ? "Checks failing"
      : skipped
        ? "Skipped"
        : "Checks pending";

  return (
    <span
      className={
        success ? "pr-success" : failure ? "pr-failure" : skipped ? "pr-muted" : "pr-pending"
      }
      title={label}
    >
      <Icon
        name={success ? "CircleCheck" : failure ? "CircleX" : skipped ? "Circle" : "Clock"}
        className="size-3.5"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function DiffStat({ additions, deletions }: { additions?: number; deletions?: number }) {
  if (additions === undefined || deletions === undefined) return null;

  return (
    <span className="pr-diff-stat">
      <span className="pr-success">+{additions.toLocaleString()}</span>
      <span className="pr-failure">-{deletions.toLocaleString()}</span>
    </span>
  );
}

export function Label({ name, color }: { name: string; color: string }) {
  return (
    <span className="pr-label" title={name}>
      <span
        aria-hidden="true"
        className="pr-label-dot"
        style={{ backgroundColor: /^[a-f\d]{6}$/i.test(color) ? `#${color}` : undefined }}
      />
      <span>{name}</span>
    </span>
  );
}

export function checksSummary(checks: Check[]) {
  const passing = checks.filter(
    (check) => check.state === "success" || check.state === "skipped",
  ).length;

  return {
    state: checks.some((check) => check.state === "failure")
      ? "failure"
      : checks.some((check) => check.state === "pending")
        ? "pending"
        : checks.length
          ? "success"
          : null,
    label: checks.length ? `${passing} of ${checks.length} passing` : "No checks",
  };
}
