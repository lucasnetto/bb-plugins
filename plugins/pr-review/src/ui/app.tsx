import { ReviewDraftPage, ReviewDraftPanel } from "./review-draft/ReviewDraftPage";
import { reviewDraftTab } from "./review-draft/navigation";
import { type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { GuideModelSettings } from "./review/GuideGenerator";
import { LinkedPrsPanel, LinkedPrHeader } from "./linked-prs";

export function registerReviewApp(app: PluginAppBuilder) {
  app.slots.navPanel({
    id: "review",
    title: "PR review",
    icon: "GitPullRequest",
    path: "review",
    component: ReviewDraftPage,
    fixedTabs: [
      {
        ...reviewDraftTab,
        title: "Pull request",
        icon: "GitPullRequest",
        component: ReviewDraftPanel,
        layout: "flush",
      },
    ],
  });
  app.slots.settingsSection({
    id: "guide-model",
    title: "Guided review model",
    description: "Default provider and model for PR guides, with optional project overrides.",
    component: GuideModelSettings,
  });
  app.slots.experimental_threadHeaderAction({
    id: "linked-prs",
    title: "Linked PRs",
    component: LinkedPrHeader,
  });
  app.slots.threadPanelAction({
    id: "linked-prs",
    title: "Linked PRs",
    icon: "GitPullRequest",
    layout: "flush",
    component: LinkedPrsPanel,
  });
  app.slots.commandPaletteAction({
    id: "linked-prs",
    title: "Open linked PRs",
    isAvailable: (ctx) => !!ctx.threadId,
    run: (ctx) => {
      ctx.openPanel({ actionId: "linked-prs" });
    },
  });
}
