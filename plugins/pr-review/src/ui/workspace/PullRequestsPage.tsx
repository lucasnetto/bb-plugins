import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { useList } from "../../../use-list";
import { stateSchema, type PrState } from "../../../contract";
import { draftPath, draftUrl } from "../review-draft/navigation";
import { DraftPrReview } from "../review/PrReview";
import { useDraftComments } from "../review-draft/comments";
import { Icon } from "../components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { PrMenu, PrMenuChoices, PrMenuItem, PrMenuSeparator } from "./Menu";
import { PullRequestRow } from "./PullRequestRow";
import { DEFAULT_FILTERS, SORT_OPTIONS, visibleRows, type Filters, type Sort } from "./list-logic";
import "./workspace.css";

interface InboxPreferences {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  sort: Sort;
  setSort: Dispatch<SetStateAction<Sort>>;
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
}
export function PullRequestsPage({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const url = draftUrl(subPath);
  const [state, setState] = useState<PrState>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [opened, setOpened] = useState<string[]>(url ? [url] : []);
  const [visible, setVisible] = useState(!!url);
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [paneWidth, setPaneWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("pr-review:pane-width:v1"));
      return saved >= 30 && saved <= 70 ? saved : 50;
    } catch {
      return 50;
    }
  });
  const root = useRef<HTMLElement>(null);
  const drag = useRef(false);
  const open = useCallback(
    (next: string) => {
      setOpened((current) => (current.includes(next) ? current : [...current, next]));
      setVisible(true);
      navigate.toPluginPanel("prs", { subPath: draftPath(next) });
    },
    [navigate],
  );
  useEffect(() => {
    if (url) {
      setOpened((current) => (current.includes(url) ? current : [...current, url]));
      setVisible(true);
    }
  }, [url]);
  const resize = (next: number) => {
    const clamped = Math.max(30, Math.min(70, next));
    setPaneWidth(clamped);
    try {
      localStorage.setItem("pr-review:pane-width:v1", String(clamped));
    } catch {
      /* Resizing works without storage. */
    }
  };
  function close(target: string) {
    const rest = opened.filter((item) => item !== target);
    setOpened(rest);
    if (url === target) {
      const next = rest.at(-1);
      if (next) open(next);
      else {
        setVisible(false);
        navigate.toPluginPanel("prs");
      }
    }
  }
  return (
    <main ref={root} className={`pr-workspace ${visible && url ? "pr-workspace-split" : ""}`}>
      <Inbox
        key={state}
        preferences={{ query, setQuery, sort, setSort, filters, setFilters }}
        state={state}
        setState={setState}
        selected={visible ? url : null}
        onSelect={open}
        onAdd={() => setAdding(true)}
        onToggle={() => {
          if (url) setVisible((current) => !current);
          else if (opened.at(-1)) open(opened.at(-1)!);
          else setAdding(true);
        }}
      />
      {url ? (
        <aside
          hidden={!visible}
          className="pr-detail-pane"
          aria-label="Pull request details"
          style={{ width: `${paneWidth}%` }}
        >
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize pull request details"
            aria-orientation="vertical"
            aria-valuemin={30}
            aria-valuemax={70}
            aria-valuenow={Math.round(paneWidth)}
            className="pr-pane-resizer"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              drag.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current || !root.current) return;
              const bounds = root.current.getBoundingClientRect();
              resize(((bounds.right - event.clientX) / bounds.width) * 100);
            }}
            onPointerUp={(event) => {
              drag.current = false;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = false;
            }}
            onLostPointerCapture={() => {
              drag.current = false;
            }}
            onDoubleClick={() => resize(50)}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) {
                event.preventDefault();
                resize(
                  event.key === "Home" ? 50 : paneWidth + (event.key === "ArrowLeft" ? 2 : -2),
                );
              }
            }}
          />
          <div className="pr-open-tabs" aria-label="Open pull requests">
            <button
              className="pr-icon-button pr-mobile-back"
              aria-label="Back to pull requests"
              onClick={() => setVisible(false)}
            >
              <Icon name="ChevronLeft" className="size-4" />
            </button>
            <div className="pr-open-tabs-scroll">
              {opened.map((item) => (
                <span
                  key={item}
                  className={`pr-open-tab ${item === url ? "pr-open-tab-active" : ""}`}
                >
                  <button
                    onClick={() => open(item)}
                    title={item}
                    aria-label={`Open ${draftPath(item)}`}
                  >
                    <Icon name="GitPullRequest" className="size-3.5" />#{item.split("/").at(-1)}
                  </button>
                  <button
                    className="pr-close-tab"
                    onClick={() => close(item)}
                    aria-label={`Close #${item.split("/").at(-1)}`}
                  >
                    <Icon name="X" className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <button
              className="pr-icon-button"
              aria-label="Open a pull request by URL"
              onClick={() => setAdding(true)}
            >
              <Icon name="Plus" className="size-4" />
            </button>
            <button
              className="pr-icon-button"
              aria-label="Hide pull request details"
              onClick={() => setVisible(false)}
            >
              <Icon name="PanelRight" className="size-4" />
            </button>
          </div>
          {opened.map((item) => (
            <div key={item} hidden={item !== url} className="pr-detail-instance">
              <InboxDetail url={item} active={item === url && visible} />
            </div>
          ))}
        </aside>
      ) : null}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open a pull request</DialogTitle>
            <DialogDescription>Paste a GitHub pull request URL.</DialogDescription>
          </DialogHeader>
          <form
            className="pr-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const path = draftPath(input);
                const next = draftUrl(path);
                if (next) open(next);
                setAdding(false);
                setInput("");
                setInputError("");
              } catch (error) {
                setInputError(String(error));
              }
            }}
          >
            <input
              autoFocus
              className="pr-text-input"
              aria-label="GitHub pull request URL"
              placeholder="https://github.com/owner/repo/pull/123"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            {inputError && (
              <p role="alert" className="pr-failure">
                {inputError}
              </p>
            )}
            <button className="pr-control pr-primary" type="submit">
              Open pull request
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
function InboxDetail({ url, active }: { url: string; active: boolean }) {
  const comments = useDraftComments(url);
  return <DraftPrReview url={url} onComment={comments.add} active={active} />;
}
function Inbox({
  preferences,
  state,
  setState,
  selected,
  onSelect,
  onAdd,
  onToggle,
}: {
  preferences: InboxPreferences;
  state: PrState;
  setState: (value: PrState) => void;
  selected: string | null;
  onSelect: (url: string) => void;
  onAdd: () => void;
  onToggle: () => void;
}) {
  const authored = useList("authored", state);
  const reviewing = useList("reviewing", state);
  const { query, setQuery, sort, setSort, filters, setFilters } = preferences;
  const search = useDeferredValue(query);
  const repositories = [
    ...new Set(
      [...(authored.result?.rows ?? []), ...(reviewing.result?.rows ?? [])].map(
        (pr) => pr.repository,
      ),
    ),
  ].sort();
  const count =
    Object.entries(filters).filter(
      ([key, value]) => value !== DEFAULT_FILTERS[key as keyof Filters],
    ).length + (state === "all" ? 0 : 1);
  const update = (key: keyof Filters) => (value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const loading = authored.loading || reviewing.loading;
  const groups = [
    { title: "Authored", key: "authored", data: authored },
    { title: "Review requested", key: "reviewing", data: reviewing },
  ].filter((group) => filters.involvement === "all" || filters.involvement === group.key);
  return (
    <section className="pr-inbox" aria-label="Pull requests">
      <div className="pr-list-toolbar">
        <div className="pr-search">
          <Icon name="Search" className="size-4" />
          <input
            type="search"
            aria-label="Search pull requests"
            placeholder="Search pull requests, or label:bug"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <PrMenu label="Sort" icon="ArrowUpDown">
          <PrMenuChoices
            label="Sort by"
            value={sort}
            options={SORT_OPTIONS}
            onChange={(value) => {
              if (SORT_OPTIONS.some((option) => option.value === value)) setSort(value as Sort);
            }}
          />
        </PrMenu>
        <PrMenu label="Filters" icon="SlidersHorizontal" count={count}>
          <PrMenuChoices
            label="State"
            value={state}
            options={[
              { value: "all", label: "Open" },
              { value: "closed", label: "Closed" },
              { value: "merged", label: "Merged" },
            ]}
            onChange={(value) => {
              const parsed = stateSchema.safeParse(value);
              if (parsed.success) setState(parsed.data);
            }}
          />
          <PrMenuChoices
            label="Involvement"
            value={filters.involvement}
            options={[
              { value: "all", label: "All" },
              { value: "authored", label: "Authored" },
              { value: "reviewing", label: "Review requested" },
            ]}
            onChange={update("involvement")}
          />
          <PrMenuSeparator />
          <PrMenuChoices
            label="Draft"
            value={filters.draft}
            options={[
              { value: "all", label: "All" },
              { value: "only", label: "Drafts only" },
              { value: "hide", label: "Hide drafts" },
            ]}
            onChange={update("draft")}
          />
          <PrMenuChoices
            label="Review"
            value={filters.review}
            options={[
              { value: "all", label: "All" },
              { value: "APPROVED", label: "Approved" },
              { value: "CHANGES_REQUESTED", label: "Changes requested" },
              { value: "REVIEW_REQUIRED", label: "Review required" },
            ]}
            onChange={update("review")}
          />
          <PrMenuChoices
            label="Checks"
            value={filters.checks}
            options={[
              { value: "all", label: "All" },
              { value: "passing", label: "Passing" },
              { value: "failing", label: "Failing" },
            ]}
            onChange={update("checks")}
          />
          <PrMenuSeparator />
          <PrMenuChoices
            label="Repository"
            value={filters.repository}
            options={[
              { value: "", label: "All repositories" },
              ...repositories.map((value) => ({ value, label: value })),
            ]}
            onChange={update("repository")}
          />
          {!!count && (
            <>
              <PrMenuSeparator />
              <PrMenuItem
                icon="RotateCcw"
                onSelect={() => {
                  setFilters(DEFAULT_FILTERS);
                  setState("all");
                }}
              >
                Reset filters
              </PrMenuItem>
            </>
          )}
        </PrMenu>
        <button
          className="pr-control pr-square"
          aria-label="Refresh"
          title="Refresh pull requests"
          disabled={loading}
          onClick={() => {
            void authored.refresh(true);
            void reviewing.refresh(true);
          }}
        >
          <Icon name="ArrowReloadHorizontal" className={loading ? "size-4 pr-spin" : "size-4"} />
        </button>
        <button
          className="pr-icon-button"
          aria-label="Toggle pull request details"
          title="Toggle pull request details"
          onClick={onToggle}
        >
          <Icon name="PanelRight" className="size-4" />
        </button>
      </div>
      <div className="pr-list-scroll" aria-busy={loading}>
        {groups.map(({ key, title, data }) => {
          const rows = visibleRows(data.result?.rows ?? [], search, filters, sort, state);
          return (
            <section key={key} className="pr-list-group" aria-label={title}>
              <h2>{title}</h2>
              {data.error && (
                <div role="alert" className="pr-inline-error">
                  {data.error}
                  <button className="pr-control" onClick={() => void data.refresh(true)}>
                    Retry
                  </button>
                </div>
              )}
              {data.result?.metadataError && (
                <p className="pr-list-notice">{data.result.metadataError}</p>
              )}
              {rows.map((pr) => (
                <PullRequestRow
                  key={pr.url}
                  pr={pr}
                  selected={selected === pr.url}
                  onSelect={onSelect}
                  state={state}
                />
              ))}
              {!rows.length && !data.loading && !data.error && (
                <div className="pr-list-empty">
                  <Icon name="GitPullRequest" className="size-6" />
                  <p>
                    {search || count
                      ? "No matching pull requests"
                      : key === "reviewing"
                        ? "No reviews waiting for you"
                        : "No pull requests here"}
                  </p>
                  <span>
                    {search || count
                      ? "Try another search or filter."
                      : "New activity will appear here."}
                  </span>
                </div>
              )}
              {data.showLoading && data.loading && (
                <div className="pr-list-skeleton" role="status" aria-label="Loading pull requests">
                  {[1, 2, 3].map((i) => (
                    <div key={i}>
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              )}
              {data.result?.incomplete && (
                <p className="pr-list-notice">
                  GitHub returned partial results or reached its 1,000-result search limit.
                </p>
              )}
              {data.result?.nextPage && (
                <div className="pr-load-more">
                  <button
                    className="pr-control"
                    disabled={data.loading}
                    onClick={() => void data.refresh(true, true)}
                  >
                    Load more {title.toLowerCase()}
                  </button>
                  <span>
                    {data.result.rows.length} of {data.result.total}
                  </span>
                </div>
              )}
            </section>
          );
        })}
        <button className="pr-open-url" onClick={onAdd}>
          <Icon name="Plus" className="size-3.5" />
          Open a pull request by URL
        </button>
      </div>
    </section>
  );
}
