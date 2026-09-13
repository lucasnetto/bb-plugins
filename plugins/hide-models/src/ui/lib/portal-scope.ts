declare const __BB_PLUGIN_ID__: string | undefined;

interface PortalScopeProps {
  "data-bb-portaled-overlay": "";
  "data-bb-plugin-root"?: "";
  "data-bb-plugin"?: string;
}

export function usePortalScopeProps(): PortalScopeProps {
  const pluginId = typeof __BB_PLUGIN_ID__ === "undefined" ? undefined : __BB_PLUGIN_ID__;

  const props: PortalScopeProps = {
    "data-bb-portaled-overlay": "",
    "data-bb-plugin-root": "",
  };

  if (pluginId !== undefined) {
    props["data-bb-plugin"] = pluginId;
  }

  return props;
}
