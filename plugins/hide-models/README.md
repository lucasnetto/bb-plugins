# bb-plugin-hide-models

Hide models per provider from bb's model picker (t3code-style). UI-only:
model discovery is untouched; the plugin filters rows in the picker.

## Use

- Settings → Plugins → **Hide Models**: uncheck models per provider.
- CLI:

```sh
bb hide-models list
bb hide-models hide codex gpt-5.6-terra
bb hide-models show codex gpt-5.6-terra
bb hide-models clear
```

## How it works

- Server: denylist `{ providerId, model, displayName }[]` in `bb.storage.kv`;
  RPC for the settings page; `GET /api/v1/plugins/hide-models/http/hidden`
  for the content script.
- Frontend content script: watches the DOM for bb's picker
  (`button > span[title]` rows inside the popover), resolves the active
  provider from the tab's `data-provider-logo` URL, and sets `display:none`
  on rows whose label matches a hidden model of that provider. Labels are
  matched by display name (exact, or suffix — bb strips the provider brand
  prefix, e.g. `GPT-5.6-Sol` → `5.6-Sol`).
- Cache: `localStorage["bb-plugin-hide-models:hidden-names"]`, refreshed from
  the server each time the picker opens and on settings changes.

## Limits

- Hidden rows stay in the DOM: keyboard arrows can still land on one, and
  search can still surface it.
- `bb provider models`, the SDK, defaults, and automations are unaffected.
- Depends on bb's picker markup (`span[title]`, `data-provider-logo`,
  active tab `border-foreground`); a bb UI change can break the filter, in
  which case rows simply show again.

## Develop

```sh
vp install
bb plugin install .   # path install
bb plugin dev         # rebuild + reload on save
```

### Effect catalog loading

Provider catalog loading uses Effect v4 with at most four concurrent provider
reads. Individual provider failures retain their error row, while plugin
disposal interrupts the overall load. The SDK currently exposes ordinary
promises for provider reads, so an individual SDK call may finish after
interruption. Hidden-list CRUD, CLI commands and HTTP reads also compose in Effect; writes
serialize to preserve concurrent changes. UI filtering remains plain TypeScript.
