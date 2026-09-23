# Jev capability audit — 2026-09-17

## Verified checkout

- pnpm 11.7.0 workspace; Vite+ 0.3.0 for formatting, custom lint, type checking and tests.
- Most existing plugins pin patched SDK 0.4.47; Orbisa pins 0.4.84.
- Installed BB scaffold pins SDK **0.4.87**. Jev gets its own `catalog:jev` pin;
  existing plugins and their ACP patch are unchanged. BB artifact metadata records
  **0.43.1 / SDK 0.4.87** (see verification record for build checks).
- `plugins/jev` follows the root-entry server/app pattern in `plugins/pr-review`.
  Created with the installed `bb plugin new jev` scaffold, replacing its todo demo.
- Permanent installation source: `/Users/example/Developer/lucasnetto/bb-plugins`.
  `plugins/profiles/refresh.py` builds once and refreshes both profile installations.
- Sidebar owner: `plugins/t3-sidebar/src/ui/app.tsx`, `ThreadRow.tsx`,
  `ThreadRowLayouts.tsx`, and `ui/lib/sidebar-logic.ts`. Its renderer consumes the
  public `PluginSidebarThread.indicator` union; that union has no plugin-status
  field. It does not render the native plugin status channel. Jev uses fallback
  slots there and registers no competing list replacement.

## Exact public contracts

Paths below are in `plugins/jev/node_modules/@get-bb/plugin-sdk/bundled-types/`.
They were inspected locally and typechecked; upstream main is not the authority.

| Capability     | Installed declaration / implemented use                                                                                               | Boundary                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle      | `bb-plugin-sdk.d.ts`, `PluginThreadEventPayloads`: seven thread lifecycle events, `interaction.pending`, `experimental_thread.events` | Observe-only invalidations, not event contents. Hidden threads excluded.                                                              |
| History        | `ThreadEventsListArgs` / `ThreadEventsArea.list`                                                                                      | `afterSeq`, `beforeSeq`, `limit` are **strings**; order asc/desc; result is `ThreadEventRow[]`, with numeric `seq` and original `id`. |
| Current state  | `ThreadsArea.get/list`, `ThreadResponse`, `ThreadInteractionsArea.list`                                                               | Runtime facts separate from semantic fixture labels; queue count and pending interactions suppress native status.                     |
| Persistence    | `PluginStorage.database/migrate`                                                                                                      | Plugin-owned better-sqlite3 and append-only migrations. No core DB access.                                                            |
| Worker         | `PluginBackground.service`, `BbPluginApi.onDispose`                                                                                   | Lifecycle abort plus settings-generation abort; jobs survive restart; fixed concurrency 1, opt-in external budget 20 attempts/day.    |
| RPC            | `defineRpcContract`, `bb.rpc.register`                                                                                                | Strict local Zod schemas at input/output boundaries; bounded results, no secret values.                                               |
| Realtime       | `bb.realtime.publish`; app `useRealtime`, `useRealtimeConnectionState`, `useRpc`                                                      | Durable read model after invalidation/reconnect; stale request guards; no evaluator per window.                                       |
| Native status  | `bb-plugin-sdk-app.d.ts`, optional `PluginContentScriptContext.experimental_setThreadRowStatus`                                       | `{icon,label,tone}` only. Feature detection, per-window bridge, abort cleanup. No arbitrary badge/click slot.                         |
| App sync       | `experimental_appOverlay`, `experimental_useSidebarThreads`                                                                           | Public hook supplies runtime/draft/background indicators; only empty native indicator eligible.                                       |
| Evidence UI    | `threadPanelAction`, `navPanel`, `experimental_threadHeaderAction`, `useBbNavigate`                                                   | Original excerpt/ID; `toThread` fallback because no public scroll-to-event API was found.                                             |
| Settings       | `settings.define/get/onChange`, secret string and bounded numeric validators                                                          | Server-only key; defaults off; changing policy cancels and purges.                                                                    |
| CLI            | `bb.cli.register`                                                                                                                     | One `jev` command, simple subcommand metadata names and plugin-owned nested argument parser.                                          |
| Workspace/host | Public `sdk.files`, `sdk.environments` and `hosts.experimental_client` exist                                                          | Deliberately unused; no server-local reads of remote thread cwd; no host entry.                                                       |
| Tools/composer | Public `agents.registerTool`, app composer APIs exist                                                                                 | Not registered in PR 00–03. No message attachment or delivery.                                                                        |
| Send/queue     | Public thread send and queue APIs exist                                                                                               | Read runtime queue count only; no assumption about next-turn-only delivery; no writes.                                                |
| Testing        | `@get-bb/plugin-sdk/testing`, `/testing/app`                                                                                          | Real SQLite fake host, lifecycle reload returns a **new host**; app harness exercises registration, hooks, and content scripts.       |

## Implemented structure

`src/domain.ts`: versioned packets/results, reviewed fixtures, evaluator contract,
redaction. `src/history.ts`: SDK pagination adapter. `src/store.ts`: durable
subjects, immutable excerpts/results, hashed jobs, leases and corrections.
`server.ts`: settings, lifecycle registration, reconciliation, worker, RPC/CLI.
`src/bridge.ts`: native status projection. `app.tsx`: read model and evidence UI.

Identity scope is project/thread/environment plus event revision. No task
acceptance, repository snapshot, host identity or provider session is inferred
from unavailable fields. Event source IDs retain provenance; fixture IDs are
synthetic and explicitly labeled. Disabled live evaluation remains skipped. `src/gateway.ts` implements the AI SDK evaluation adapter with mandatory per-request ZDR.

No public SDK extensions, private `@bb/*` imports, installed-bundle modifications,
or BB core changes were needed. T3's native-indicator limitation is a documented
fallback, not evidence that rich sidebar status is universally supported.
