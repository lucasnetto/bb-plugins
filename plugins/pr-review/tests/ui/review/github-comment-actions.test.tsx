// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { Schema } from "effect";
import { githubReviewMutation } from "../../../src/shared/github-review-contract";
import { fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  GithubReviewState,
  GithubReviewAction,
} from "../../../src/shared/github-review-contract";

const state: GithubReviewState = {
  login: "reviewer",
  author: "author",
  head: "a".repeat(40),
  pending: null,
  comments: [
    {
      id: 20,
      node_id: "C20",
      body: "Published comment",
      path: "a.ts",
      outdated: false,
      subjectType: "LINE",
      line: 4,
      original_line: 4,
      side: "RIGHT",
      user: { login: "reviewer" },
      html_url: "https://github.com/org/repo/pull/1#discussion_r20",
      pull_request_review_id: 10,
      threadId: "T1",
      createdAt: "2026-09-15T18:00:00Z",
      resolved: false,
      canReply: true,
      canResolve: true,
      canUnresolve: false,
    },
  ],
};

async function mount(initial = state, fail = false) {
  installTestPluginRuntime();
  const { GithubReviewThread } = await import("../../../src/ui/review/GithubReviewThread");
  const { useGithubReview } = await import("../../../src/ui/review/useGithubReview");
  const writes: GithubReviewAction[] = [];
  let current = initial;

  function Panel() {
    const review = useGithubReview(null, "https://github.com/org/repo/pull/1");
    const comment = review.state?.comments[0];

    return (
      <>
        {comment && <GithubReviewThread comments={review.state?.comments ?? []} review={review} />}
        <span>{review.error}</span>
      </>
    );
  }

  const slot = renderSlot(
    { component: Panel },
    {},
    {
      rpc: {
        githubReview: () => current,
        githubReviewMutate: (input) => {
          const { action } = Schema.decodeUnknownSync(githubReviewMutation)(input);
          writes.push(action);

          if (fail) throw new Error("offline");

          if (action.kind === "resolve")
            current = {
              ...current,
              comments: current.comments.map((c) => ({
                ...c,
                resolved: action.resolved,
                canResolve: !action.resolved,
                canUnresolve: action.resolved,
              })),
            };

          return { url: state.comments[0].html_url };
        },
      },
    },
  );

  await slot.findByText("Published comment");

  return { slot, writes };
}

test("published comments offer editing and require confirmation before deletion", async () => {
  const { slot, writes } = await mount();

  try {
    fireEvent.keyDown(slot.getByRole("button", { name: "Comment actions" }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitem", { name: "Edit comment" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Edit comment on a.ts" }), {
      target: { value: "Updated" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Save comment" }));
    await waitFor(() =>
      expect(writes).toEqual([
        expect.objectContaining({
          kind: "edit",
          body: "Updated",
          previousBody: "Published comment",
          reviewId: null,
        }),
      ]),
    );
    fireEvent.keyDown(await slot.findByRole("button", { name: "Comment actions" }), {
      key: "Enter",
    });
    fireEvent.click(await slot.findByRole("menuitem", { name: "Delete comment" }));
    expect(writes).toHaveLength(1);
    fireEvent.click(slot.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() =>
      expect(writes[1]).toMatchObject({
        kind: "remove",
        commentId: 20,
        previousBody: "Published comment",
      }),
    );
  } finally {
    slot.lifecycle.unmount();
  }
});

test("replies and resolution work on others' comments while edit and delete stay hidden", async () => {
  const { slot, writes } = await mount({
    ...state,
    comments: [{ ...state.comments[0], user: { login: "someone-else" } }],
  });

  try {
    expect(slot.queryByRole("button", { name: "Comment actions" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Reply" }));
    expect(slot.getByRole("button", { name: "Post reply" })).toHaveProperty("disabled", true);
    fireEvent.change(slot.getByRole("textbox", { name: "Reply on a.ts" }), {
      target: { value: "Thanks" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Post reply" }));
    await waitFor(() =>
      expect(writes[0]).toMatchObject({
        kind: "reply",
        threadId: "T1",
        body: "Thanks",
        reviewId: null,
      }),
    );
    await waitFor(() =>
      expect(slot.getByRole("button", { name: "Resolve conversation" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    fireEvent.click(slot.getByRole("button", { name: "Resolve conversation" }));
    fireEvent.click(await slot.findByRole("button", { name: "Reopen conversation" }));
    await waitFor(() =>
      expect(writes[2]).toMatchObject({ kind: "resolve", resolved: false, previousResolved: true }),
    );
  } finally {
    slot.lifecycle.unmount();
  }
});

test("failed replies preserve text and pending replies are labeled as private", async () => {
  const { slot, writes } = await mount(
    {
      ...state,
      pending: {
        id: 1,
        node_id: "R1",
        body: "",
        commit_id: state.head,
        html_url: state.comments[0].html_url,
      },
    },
    true,
  );

  try {
    fireEvent.click(slot.getByRole("button", { name: "Reply" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Reply on a.ts" }), {
      target: { value: "Keep this reply" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Add reply to review" }));
    await slot.findByText(/offline/);
    expect(slot.getByRole("textbox", { name: "Reply on a.ts" })).toHaveProperty(
      "value",
      "Keep this reply",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: "reply", reviewId: 1 });
  } finally {
    slot.lifecycle.unmount();
  }
});

test("a conversation shows replies together with one composer and resolution control", async () => {
  const { slot } = await mount({
    ...state,
    comments: [
      state.comments[0],
      { ...state.comments[0], id: 21, body: "Follow-up reply", user: { login: "author" } },
    ],
  });

  try {
    expect(slot.getAllByRole("region", { name: "Conversation on a.ts" })).toHaveLength(1);
    expect(slot.getAllByRole("button", { name: "Reply" })).toHaveLength(1);
    expect(slot.getAllByRole("button", { name: "Resolve conversation" })).toHaveLength(1);
    expect(slot.getByText("Follow-up reply")).toBeTruthy();
    expect(slot.getByText("Author")).toBeTruthy();
  } finally {
    slot.lifecycle.unmount();
  }
});

test("collapsing a conversation preserves unsaved replies and edits", async () => {
  const { slot, writes } = await mount();

  try {
    fireEvent.click(slot.getByRole("button", { name: "Reply" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Reply on a.ts" }), {
      target: { value: "Unsent reply" },
    });
    fireEvent.keyDown(slot.getByRole("button", { name: "Comment actions" }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitem", { name: "Edit comment" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Edit comment on a.ts" }), {
      target: { value: "Unsaved edit" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Collapse conversation on a.ts" }));
    expect(slot.queryByRole("textbox")).toBeNull();
    expect(slot.queryByRole("button", { name: "Resolve conversation" })).toBeNull();
    expect(
      slot
        .getByRole("button", { name: "Expand conversation on a.ts" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    fireEvent.click(slot.getByRole("button", { name: "Expand conversation on a.ts" }));
    expect(slot.getByRole("textbox", { name: "Reply on a.ts" })).toHaveProperty(
      "value",
      "Unsent reply",
    );
    expect(slot.getByRole("textbox", { name: "Edit comment on a.ts" })).toHaveProperty(
      "value",
      "Unsaved edit",
    );
    expect(writes).toHaveLength(0);
  } finally {
    slot.lifecycle.unmount();
  }
});
