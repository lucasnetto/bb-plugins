import { LocalChangesPanel } from "./src/local-changes/Panel";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { registerReviewApp } from "./src/ui/app";
import { PullRequestsPage } from "./src/ui/workspace/PullRequestsPage";

export { PullRequestsPage };

export default definePluginApp((app) => {
  registerReviewApp(app);
  app.slots.threadPanelAction({
    id: "local-changes",
    title: "Local Changes",
    icon: "FileDiff",
    layout: "flush",
    component: LocalChangesPanel,
  });
  app.slots.commandPaletteAction({
    id: "local-changes",
    title: "Open local changes",
    isAvailable: (ctx) => !!ctx.threadId,
    run: (ctx) => {
      ctx.openPanel({ actionId: "local-changes" });
    },
  });
  app.slots.navPanel({
    id: "pull-requests",
    title: "Pull Requests",
    icon: "GitPullRequest",
    path: "prs",
    component: PullRequestsPage,
  });
});
