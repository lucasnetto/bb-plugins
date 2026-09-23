import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ModelSettings } from "./model-settings";

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "model", component: ModelSettings });
});
