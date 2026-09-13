import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { registerReviewApp } from "./src/ui/app";
import { PullRequestsPage } from "./src/ui/workspace/PullRequestsPage";

export { PullRequestsPage };

export default definePluginApp((app) => {
  registerReviewApp(app);
  app.slots.navPanel({
    id: "pull-requests",
    title: "Pull Requests",
    icon: "GitPullRequest",
    path: "prs",
    component: PullRequestsPage,
  });
});
