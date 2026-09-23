# Jev verification — September 17, 2026

## Scope and source

Implemented the handoff's PR 00–03 and PR 04 adapter as one plugin: offline fixtures, separately
approved local event capture, durable evidence/jobs/results, revision fencing,
corrections, native status bridge, and page/header/panel fallbacks. The opt-in adapter uses Vercel AI Gateway evaluation with mandatory ZDR. Three synthetic smoke attempts reached Gateway and returned HTTP 403 explicitly rejecting ZDR. No real bb-plugins history was sent, and no provider execution, workspace edit, message send, or email action was performed. Source is in `plugins/jev`; root changes register its SDK
catalog/lockfile and Vite+ test project. Existing plugin source was unchanged.

Working branch: `implement-bb-plugins-jev-plugin-thr_emuyfg6rds`. Validated source was
also copied to the clean permanent checkout for the required installation;
changes remain uncommitted in both checkouts.

## Automated checks

- `pnpm exec vp check plugins/jev docs/plans/jev vite.config.ts pnpm-workspace.yaml`:
  formatting, custom lint and TypeScript passed. Final source also passed
  `pnpm exec vp check --fix plugins/jev` without errors or warnings.
- `pnpm exec vp test --project jev`: **48 passed**, three test files; one opt-in network smoke test skipped in the default suite.
- `git diff --check`: passed.
- `bb plugin build`: server and app bundles generated successfully. Metadata:
  BB **0.43.1**, SDK **0.4.87**, plugin **0.2.0**.
- Full `pnpm exec vp test`: 441 passed, 2 skipped, **2 native worker crashes**;
  not a passing full-suite run. Node 24.21.0 / better-sqlite3 12.11.1 aborted in
  `node::RemoveEnvironmentCleanupHook`, `Statement::~Statement`.
- Reproduction with Jev excluded, `pnpm exec vp test --project '!jev' --maxWorkers=1`:
  390 passed, 2 skipped, **3 native worker crashes**. This failure also occurs
  outside Jev; no unrelated test/runtime patches were made.

The Jev tests exercise six labeled fixtures, arbitrary-input abstention,
cancellation, secret redaction, migrations, job deduplication and leases,
revision fencing, exact-revision annotations, reload recovery, registration/RPC
validation, settings changes, public SDK import scanning, paginated original
history, coverage bounds, missing pages, deletion, coalesced/out-of-order
notifications, queue/runtime precedence, and disabling during a pending read.
Frontend tests cover both bridge mount orders, reconnect, multiple independent
window bridges, absent setter, evidence navigation fallback, correction RPCs,
cleanup, and native permission/runtime/background/goal/plan/draft/error states.

## Installed runtime verification

`bb profiles refresh jev` and `bb profiles refresh jev --check` ran from
`/Users/example/Developer/lucasnetto/bb-plugins`. Personal and Work both reported
`jev@0.2.0`, running, healthy, and matching build `5ff0c1565abebaf1` / bundle
`d86c14ef9dbf9e4e`. The key was securely imported into Personal's server-only
secret setting through `bb jev key-from-env`; no value was printed or committed.

Personal: attention and fixture mode enabled, bb-plugins (`proj_pc75wdzt7y`) approved,
live manual checks enabled, capture and automatic checks disabled, daily limit 20. The installed `bb jev smoke decision` returned a durable error result:
HTTP 403, required ZDR policy rejected, no label, usage unknown. The same error result survived an actual plugin reload without another request.
This confirms the installed adapter/credential/error path, not successful inference. Work
retains feature defaults off and did not receive the Personal key.

The earlier 0.1 offline decision/credentials demo and revision annotations
survived reload; configuration changes intentionally clear prior evidence.

## Live UI blocker and remaining gaps

The user granted computer-use permission. Three attempts were made:

1. Native BB app selection: computer-use service timed out after approximately
   122 seconds, with no usable UI state.
2. In-app browser: reported `Browser is not available: iab`.
3. Native Phi browser selection: timed out and reset the computer-use kernel.

Therefore live layout, actual native sidebar rendering, T3 visual coexistence,
and multi-window remote UI behavior are **not visually verified**. No screenshot
is claimed. Fake-host checks do not establish live layout, provider delivery,
remote host routing, or multi-plugin arbitration. Existing providers were not
started for testing. The code deliberately falls back to the evidence panel,
header and Attention page where native status support is absent.

## Live adapter and remaining boundary

The user supplied the key through BB Secrets, outside chat. The live adapter
always passes `zeroDataRetention: true` and `disallowPromptTraining: true`.
The real SDK wire-format tests verify those flags, no SDK retries, response
validation, redaction, cancellation, body limits, and sanitized 401/403/429/5xx
errors. Additional tests cover durable budget accounting after clear, no replay
of interrupted Gateway requests, live-off gates before content reads, and UI
failure/unknown-usage presentation. The isolated SQLite teardown crash is avoided
in this plugin's test configuration with `isolate: false`.

Synthetic live smoke failed three times (two SDK tests, one installed plugin): HTTP 403, required ZDR policy rejected.
This is an account/provider-policy blocker, not a successful Jev prediction.
ZDR was never disabled and no fallback was attempted. Real bb-plugins evidence checks
and held-out accuracy measurements remain unverified. Automatic capture/checks
remain off. UI selection was retried and again timed out after approximately
123 seconds, so live visual QA remains blocked.

Install/demo/disable instructions: [plugin README](../../../plugins/jev/README.md).
Exact APIs and limitations: [capability audit](capabilities.md).


## Follow-up: user-authorized no-ZDR bb-plugins test

Jev 0.2.1 adds `requireZdr` (default true). Personal was explicitly configured
with `requireZdr=false` for the approved bb-plugins project, as requested by the user.
Work retains the default. Prompt-training opt-out remains true. Each result
records the actual requested retention policy; changing policy clears old
projections and uses a separate job hash.

The synthetic SDK smoke with ZDR disabled returned HTTP 403, now classified as
a billing or credit restriction. No real thread evidence was sent. The installed
plugin smoke reproduced that error. Successful inference remains blocked.

Validation: formatting, lint, TypeScript and build passed. Focused tests passed
49/49 with `--maxWorkers=1` (one opt-in network test skipped). An earlier concurrent
run hit the previously observed native SQLite cleanup crash. Both profile installs
are healthy at 0.2.1, build `8c80b20f050b920f`, bundle `1fb875f056e62ae3`.
