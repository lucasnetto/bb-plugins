import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { GuideModelSettings } from "./review/GuideGenerator";
import { LinkedPrsPanel, LinkedPrHeader } from "./linked-prs";
import { Workspace } from "./workspace/Workspace";

function ReposPage() {
  return <Workspace />;
}
export default definePluginApp((app) => {
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
  app.slots.navPanel({
    id: "repos",
    title: "Repos",
    icon: "FolderGit2",
    path: "repos",
    component: ReposPage,
  });
  app.slots.threadPanelAction({
    id: "repos",
    title: "Repos",
    icon: "FolderGit2",
    layout: "flush",
    component: ReposPage,
  });
});
