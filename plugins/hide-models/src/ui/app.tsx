import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountHideModels } from "./content-script";
import { HideModelsSettings } from "./settings/HideModelsSettings";

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "hide-picker-rows", mount: mountHideModels });
  app.slots.settingsSection({
    id: "hidden-models",
    title: "Hidden models",
    description: "Choose which models each provider shows in bb's model picker.",
    component: HideModelsSettings,
  });
});
