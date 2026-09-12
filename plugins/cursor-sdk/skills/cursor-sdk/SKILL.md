---
name: cursor-sdk
description: Configure or troubleshoot the BB Cursor SDK provider's local/cloud runtime default and conversation behavior.
---

Use the single `cursor-sdk` provider. The New thread composer has a **cloud**
switch that appears only when Cursor SDK is selected. Off means local. It changes
the `cloudAgents` plugin setting for this BB instance; open windows synchronize.
Expanded composers show it by Send, compact composers above the input. Visibility
uses CSS matching BB's native model-picker title because the SDK has no selected
provider hook. If BB changes that markup, use plugin settings or the CLI instead.

Inspect or set the same value through the CLI:

```sh
bb plugin config cursor-sdk
bb plugin config cursor-sdk set cloudAgents true
bb plugin config cursor-sdk set cloudAgents false
```

`true` selects cloud and `false` local for new conversations when they first
start. This is not a per-thread setting. Existing native agent IDs retain their
runtime across setting changes and restarts. Model, thinking, and Fast controls
remain independent. Settings and credentials belong to the current instance;
do not switch profiles to resolve authentication failures.

Cloud starts from a clean, pushed GitHub commit and requires repository access
in Cursor. Local BB tools, host paths and environment variables are unavailable
remotely. Stop cancels the cloud run; releasing or closing BB detaches. After
reconnecting to an active cloud run, follow its Cursor link until it finishes,
then retry the follow-up. Output missed during disconnection is not replayed.

Install the pinned host runtime using Settings → Providers or:
`bb machine provider-cli install <host-id> cursor-sdk`.
