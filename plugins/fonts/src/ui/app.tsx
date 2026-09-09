import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { resolveFonts } from "../shared/fonts";

export function FontStyles({ values }: { values?: Record<string, unknown> }) {
  const fonts = resolveFonts(values);
  const declarations = [
    fonts.ui && `--font-sans: ${fonts.ui} !important;`,
    fonts.code && `--font-mono: ${fonts.code} !important;`,
    // BB's source/diff viewer uses Pierre's own font tokens inside a shadow
    // root. These inherited properties reach it; --font-mono alone does not.
    fonts.ui && `--diffs-header-font-family: ${fonts.ui} !important;`,
    fonts.code && `--diffs-font-family: ${fonts.code} !important;`,
  ]
    .filter(Boolean)
    .join("\n");

  // React owns this node: reset, disable and reload remove our overrides and
  // reveal the current theme's fonts, without restoring a stale theme snapshot.
  return declarations === "" ? null : (
    <style data-bb-fonts="">{`:root:root { ${declarations} }`}</style>
  );
}

function LiveFonts() {
  const { values } = useSettings();
  return <FontStyles values={values} />;
}

function FontPreview() {
  const { values, isLoading } = useSettings();
  const fonts = resolveFonts(values);

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading fonts…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <p className="mb-3 text-xs text-muted-foreground">Interface</p>
          <div style={{ fontFamily: fonts.ui ?? "var(--font-sans)" }} className="space-y-2">
            <p className="text-xl font-semibold">Make room for your next idea.</p>
            <p className="text-sm">The quick brown fox jumps over the lazy dog.</p>
            <p className="text-sm text-muted-foreground">Aa Bb Cc · 0123456789 · Il1 O0</p>
          </div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="mb-3 text-xs text-muted-foreground">Code</p>
          <pre
            className="overflow-x-auto text-sm leading-relaxed"
            style={{ fontFamily: fonts.code ?? "var(--font-mono)" }}
          >
            <code style={{ fontFamily: "inherit" }}>
              {'const greeting = "Hello, BB";\nconst sum = (a, b) => a + b;\n// 0O 1lI {} [] => !='}
            </code>
          </pre>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Changes save automatically for this profile and apply to its open windows. Fonts must be
        available on the device displaying BB; unavailable families use a fallback. This plugin does
        not download fonts. Choose BB default to use your current theme’s font.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  // The app-wide owner keeps the settings subscription alive on every route.
  app.slots.experimental_appOverlay({ id: "live-fonts", component: LiveFonts });
  app.slots.settingsSection({ id: "preview", title: "Preview", component: FontPreview });
});
