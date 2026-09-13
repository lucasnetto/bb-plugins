import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { WorkersPanel } from "./panel";
import { WorkerSettings } from "./settings";

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "presets", title: "Worker presets", component: WorkerSettings });
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
