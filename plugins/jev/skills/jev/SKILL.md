---
name: jev
description: Inspect Jev attention results or replay explicit offline Jev fixtures in BB.
---

# Jev attention

This release is read-only with offline fixtures and opt-in Gateway evaluation. Do not describe fixture labels as live
analysis of a user's thread. Do not enable local capture without project approval.

- `bb jev eval replay <id>` queues a fixture when attention is enabled; no separate fixture switch is needed.
- IDs: `decision`, `rhetorical`, `quoted`, `credentials`, `unrelated-error`, `uncertain`.
- `bb jev list` reads bounded result summaries. Original excerpts are in Jev Attention or the Jev evidence thread panel.
- `bb jev clear` removes Jev-owned evidence, jobs, results and corrections.
- Settings → Jev controls `attentionEnabled`, `captureEnabled`, `approvedProject`, and `retentionDays`. Evidence packets have a fixed 8,000-character limit.
- Disabling attention cancels work and clears stored projections. Changing settings clears captured state.
- The server-only `gatewayApiKey` is used only server-side for live checks; offline fixtures never use it for inference. Never read or print secret settings.

Live evaluation uses Vercel AI Gateway `typesafe-ai/jev` with configurable ZDR (`requireZdr`, default true) and no automatic fallback. Disabling ZDR requires explicit authorization for that project and evaluation. A Gateway error is not a classification.

- `bb jev smoke <fixture>` queues synthetic evidence through Gateway.
- `bb jev check <thread-id>` queues an approved, idle, visible thread's bounded history.
- `bb jev key-from-env <absolute-server-local-private-file>` imports AI_GATEWAY_API_KEY into BB's secret setting without printing it. Use the Secrets skill for credential entry; never read the file into agent context.
- `liveEnabled` separately permits external processing; `automaticChecks` also requires capture. Default daily limit is 20 attempts, including retries. All feature switches default off.
- Probability thresholds are provisional. Do not claim calibrated accuracy, task success, or user acceptance. Unknown usage remains unknown.

Obtain project approval before processing its content externally. No automatic actions are supported. Inspect the README for live smoke blockers before starting a real-evidence pilot.
