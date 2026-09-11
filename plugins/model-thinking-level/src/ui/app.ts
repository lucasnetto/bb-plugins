import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./app.css";

export default definePluginApp((app) => {
  // An active content script keeps the stylesheet mounted on every app route.
  // BB removes it when this plugin is disabled, removed, or replaced on reload.
  app.contentScripts.register({ id: "show-thinking-level", mount: () => undefined });
});
