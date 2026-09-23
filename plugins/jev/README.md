# Jev attention

Read-only attention infrastructure for BB, covering PR 00–03 and the PR 04
Vercel AI Gateway adapter. Offline demos need no key. Live checks are opt-in
and use the configured retention policy (ZDR required by default). The plugin does not change
providers, send messages, read workspace files, or touch email.

## Install and try

Use the permanent bb-plugins checkout, never an ephemeral worktree:

```sh
pnpm install
bb profiles refresh jev --install-missing
bb profiles refresh jev --check
bb plugin config jev set attentionEnabled true
bb plugin config jev set fixtureMode true
bb jev eval replay decision
bb jev list
```

If `bb` resolves to Babashka in a login shell, use `"$BB_CLI"` instead.
Open **Jev Attention** in the sidebar. Select a fixture, run it, expand its
evidence, and dismiss or mark the exact evaluated revision incorrect. Six
reviewed examples cover a genuine decision, rhetorical and quoted questions,
missing credentials, a recovered error, and insufficient context. These are
integration fixtures, not measured model predictions.

The **Jev evidence** thread panel and **Jev** header button work with T3's
custom sidebar. To preview a synthetic label on an existing idle thread, first
select its project in Settings → Jev → Approved project. The UI explicitly
labels this as a fixture preview; it does not classify the conversation. A new
thread revision supersedes it. The standard BB sidebar can show a native icon
when no runtime, permission, queue, draft, background, or other native indicator
needs the space. T3 does not render that native plugin channel, so it uses the
header/panel/page fallback. No sidebar replacement is registered.

## Local evidence capture

`captureEnabled` is separately off by default. With attention enabled and a
project explicitly selected, it captures bounded, finalized visible user and
assistant messages from that project's nonhidden threads. These results say
**Not classified** unless live and automatic checks are also enabled. Event notifications invalidate projections; original event
history supplies IDs and excerpts. The plugin never uses notification summaries
as evidence and never reads provider reasoning or environment payloads.

SQLite state is owned by BB under the Jev plugin. Jobs use content hashes,
30-second leases, three attempts, a one-day deadline, revision fencing and a
single cancellable worker. History uses the installed SDK's string `afterSeq`,
`beforeSeq`, and `limit`, numeric event sequences, and array pages. A page cursor
commits with its evidence; the dirty subject persists until a job is enqueued,
so a crash between page ingestion and enqueue is replayable.

Limits: 100 tracked subjects, 100 pending jobs, 100 retained message excerpts
per thread, 100 results per RPC, 10 history pages per subject per cycle, and
256–16,000 characters per evidence packet. Recent messages are preferred when
packets truncate. Coverage explicitly records omitted events (including
nonmessage events). Project discovery advances in 20-thread pages every 30
seconds; lifecycle notifications wake dirty subjects sooner. Threads beyond the
subject cap require clearing data or narrowing project scope. Retention defaults
to seven days after capture, configurable from one to thirty; the worker prunes
old evidence/results while enabled. Exact event scrolling is unavailable through
the public app API, so the UI shows source IDs and excerpts with Open thread.

Redaction removes the configured Gateway key, common credential assignments,
bearer tokens, common API-token prefixes and private-key blocks before storage.
It is deliberately **not a guarantee that every secret format is detectable**.
Live processing additionally requires `liveEnabled`; automatic checks require
`automaticChecks` and local capture. All these switches default off.

## Disable and clean up

```sh
bb jev clear
bb plugin config jev set attentionEnabled false
# Or unload the entire plugin:
bb plugin disable jev
```

Changing settings cancels work and clears captured state and annotations so old
scope/policy results cannot reappear. `clear` removes Jev evidence and results but retains request accounting; with
capture still enabled, new captures can occur. Disable capture/attention to keep
it empty. Disabling the plugin aborts its worker and clears frontend indicators.
Secrets are server-only BB secret settings; they are never returned by result
RPCs or included in the frontend bundle. Do not paste credentials into chat.

## Vercel AI Gateway + ZDR

Live evaluation uses AI SDK 7's `experimental_evaluate` with
`gateway.evaluationModel("typesafe-ai/jev")`. Every request sets `providerOptions.gateway.zeroDataRetention` from the
`requireZdr` setting (default true) and `disallowPromptTraining: true`.
There is no automatic policy fallback. The user authorized `requireZdr=false`
for Personal bb-plugins testing; Work retains the default.
No team-wide setting is needed by this implementation.

Provide `AI_GATEWAY_API_KEY` through BB's Secrets plugin into a private dotenv
file, then import it without putting the value in chat or command arguments:

```sh
bb jev key-from-env /absolute/server-local/private.env
bb plugin config jev set approvedProject YOUR_PROJECT_ID
bb plugin config jev set liveEnabled true
bb jev smoke decision
bb jev list
# After the synthetic check succeeds:
bb jev check YOUR_IDLE_THREAD_ID
```

The import validates private file permissions and stores the key as a server-only
BB secret setting. The UI exposes only whether a key is configured. Never print
or commit the dotenv file. For manual checks, local background capture can stay
off. The Attention page tests synthetic fixtures through Gateway; the thread
panel checks that thread's bounded visible history.

Default limit: 20 attempts per UTC day (configurable 1–100), shared by all
windows and including failures/retries. Requests time out after 15 seconds;
response bodies are capped at 64 KiB. Only HTTP 429/5xx failures can retry, with
at most three total durable attempts and no SDK retries. Interrupted requests
are recorded as unknown delivery/usage and are not automatically repeated.
Clearing evidence does not reset the daily limit. Usage is reported when supplied;
missing usage is unknown, not zero. Request accounting contains no excerpts or
keys and remains after evidence retention expires.

The adapter validates answer choices, evidence IDs, probability distributions,
and token counts. It publishes attention only with a supporting original excerpt
and model-reported probability >=0.80. This threshold is provisional and is not
calibrated accuracy. Requested/returned model aliases are recorded; the SDK does
not expose an immutable upstream model version here. Original evidence, coverage,
latency, probabilities, failures, and exact-revision corrections are inspectable.

The September 17 synthetic smoke reached Gateway but received HTTP 403 rejecting
the required ZDR policy. A subsequent user-authorized synthetic test with ZDR
disabled received HTTP 403 for a billing or credit restriction. No real bb-plugins
evidence was sent. Resolve Gateway account billing/access before a live pilot.

Sources checked September 17, 2026:
[Evaluation API](https://vercel.com/docs/ai-gateway/modalities/evaluation),
[ZDR enforcement and provider policies](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr).

Held-out accuracy measurements, lint, trace analysis, retrieval, automatic
feedback, full agent trials, and email remain later work.

See [capability audit](../../docs/plans/jev/capabilities.md) and
[verification record](../../docs/plans/jev/verification.md).
