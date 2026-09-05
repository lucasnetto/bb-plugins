// bb-plugin-t3-sidebar — frontend entry.
//
// Replaces bb's sidebar thread list with a t3code-style list: one flat,
// cross-project stream of thread cards (pinned on top, then active in
// creation order) plus a collapsible "Settled" shelf of slim rows at the
// bottom. Status lives in each card's label (Working / Input / Done / Failed
// / Plan Ready), never in list position. See components/sidebar/.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { T3ThreadList } from "@/ui/components/sidebar/T3ThreadList";
import { ProjectsPanel } from "@/ui/components/projects/ProjectSettingsPanel";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "projects",
    path: "projects",
    title: "Projects",
    icon: "Folder",
    component: ProjectsPanel,
  });
  app.slots.experimental_threadList({
    id: "t3-thread-list",
    title: "T3 Sidebar",
    description:
      "t3code-style inbox: flat thread cards, pinned block, and a collapsible Settled shelf.",
    component: T3ThreadList,
  });
});
