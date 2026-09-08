import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { WorkersPanel } from "./panel";

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "workers",
    title: "Workers",
    icon: "Users",
    layout: "flush",
    component: WorkersPanel,
  });
  app.slots.commandPaletteAction({
    id: "workers",
    title: "Open workers",
    isAvailable: (ctx) => !!ctx.threadId,
    run: (ctx) => {
      ctx.openPanel({ actionId: "workers" });
    },
  });
});
