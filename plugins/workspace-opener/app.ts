import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountWorkspaceOpener } from "./intercept.ts";

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "prefer-workspace", mount: mountWorkspaceOpener });
});
