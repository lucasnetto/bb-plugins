// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { GithubReviewState } from "../../../src/shared/github-review-contract";
import { githubSelection } from "../../../src/ui/review/githubSelection";

const initial: GithubReviewState = {
  login: "reviewer",
  author: "author",
  head: "a".repeat(40),
  pending: {
    id: 1,
    node_id: "R1",
    body: "",
    commit_id: "a".repeat(40),
    html_url: "https://github.com/org/repo/pull/1",
  },
  comments: [],
};

test("normalizes upward multiline selections and rejects cross-side ranges", () => {
  expect(githubSelection({ start: 8, end: 4, side: "deletions" })).toEqual({
    side: "LEFT",
    line: 8,
    startLine: 4,
    startSide: "LEFT",
  });
  expect(githubSelection({ start: 4, end: 4, side: "additions" })).toEqual({
    side: "RIGHT",
    line: 4,
  });
  expect(() =>
    githubSelection({ start: 4, end: 4, side: "deletions", endSide: "additions" }),
  ).toThrow("one side");
});

test("background refresh preserves visible state and typed summary, including after failure", async () => {
  installTestPluginRuntime();
  const { useGithubReview } = await import("../../../src/ui/review/useGithubReview");
  const { GithubReviewPanel } = await import("../../../src/ui/review/GithubReviewPanel");

  function Panel() {
    const review = useGithubReview(null, "https://github.com/org/repo/pull/1");

    return <GithubReviewPanel head={initial.head} review={review} onReveal={() => {}} />;
  }

  let calls = 0;
  let resolve: (value: GithubReviewState) => void = () => {};

  let reject: (error: Error) => void = () => {};

  const slot = renderSlot(
    { component: Panel },
    {},
    {
      rpc: {
        githubReview: () => {
          calls++;

          if (calls === 1) return initial;

          return new Promise<GithubReviewState>((done, fail) => {
            resolve = done;
            reject = fail;
          });
        },
      },
    },
  );

  try {
    fireEvent.click(slot.getByRole("button", { name: "GitHub review" }));
    const summary = await slot.findByRole("textbox", { name: "Review summary" });
    fireEvent.change(summary, { target: { value: "Still typing" } });
    fireEvent.focus(window);
    await waitFor(() => expect(calls).toBe(2));
    expect(slot.getByRole("textbox", { name: "Review summary" })).toHaveProperty(
      "value",
      "Still typing",
    );
    expect(slot.queryByText("Connecting to GitHub…")).toBeNull();
    resolve({ ...initial, head: "b".repeat(40) });
    await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
    fireEvent.click(slot.getByRole("button", { name: "Refresh review" }));
    await waitFor(() => expect(calls).toBe(3));
    reject(new Error("offline"));
    await slot.findByRole("alert");
    expect(slot.getByRole("textbox", { name: "Review summary" })).toHaveProperty(
      "value",
      "Still typing",
    );
  } finally {
    slot.lifecycle.unmount();
  }
});

test("a successful write is not retried when readback fails; stale reads cannot replace its state", async () => {
  installTestPluginRuntime();
  const { useGithubReview } = await import("../../../src/ui/review/useGithubReview");

  function Panel() {
    const r = useGithubReview(null, "https://github.com/org/repo/pull/2");

    return (
      <>
        <span>{r.state?.head}</span>
        <span>{r.notice}</span>
        <span>{r.error}</span>
        <button
          disabled={!r.synced || r.busy}
          onClick={() =>
            void r.mutate({
              kind: "remove",
              login: "reviewer",
              reviewId: 1,
              commentId: 2,
              previousBody: "text",
            })
          }
        >
          Remove
        </button>
      </>
    );
  }

  let reads = 0,
    writes = 0;

  let resolveStale: (value: GithubReviewState) => void = () => {};

  let resolveWrite: (value: { url: string }) => void = () => {};

  const slot = renderSlot(
    { component: Panel },
    {},
    {
      rpc: {
        githubReview: () => {
          reads++;

          if (reads === 1) return initial;

          if (reads === 2)
            return new Promise<GithubReviewState>((done) => {
              resolveStale = done;
            });
          throw new Error("readback offline");
        },
        githubReviewMutate: () => {
          writes++;

          return new Promise((done) => {
            resolveWrite = done;
          });
        },
      },
    },
  );

  try {
    await slot.findByText(initial.head);
    fireEvent.focus(window);
    await waitFor(() => expect(reads).toBe(2));
    fireEvent.click(slot.getByText("Remove"));
    await waitFor(() => expect(writes).toBe(1));
    resolveWrite({ url: "https://github.com/org/repo/pull/2" });
    await slot.findByText("Saved to GitHub.");
    resolveStale({ ...initial, head: "stale" });
    await slot.findByText(/readback offline/);
    expect(slot.queryByText("stale")).toBeNull();
    expect(writes).toBe(1);
    expect(slot.getByText("Remove")).toHaveProperty("disabled", true);
  } finally {
    slot.lifecycle.unmount();
  }
});
