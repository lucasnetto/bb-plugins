# Workers

View child workers inside their parent's right panel, including hidden threads.
Open **Workers** from the thread panel's Actions menu, or **Open workers** in the
command palette. Use the compact worker picker to read its live conversation, reply, resolve
an interaction, or stop it using BB's native compact chat.

The compact picker shows worker titles and statuses. Model and reasoning details
appear below it. The panel does not change sidebar visibility or archive state.

Workers are direct children of the current thread (across projects/providers).
Archived and unarchived children appear together. The picker opens the first
worker automatically and leaves the rest of the panel for chat. Workers are
paginated in groups of 25;
lifecycle events refresh immediately, with a ten-second fallback while mounted.
Idle means the thread is idle; it does not imply the task succeeded.

To delegate without sidebar clutter, create the child with:

```sh
bb thread spawn --project <project-id> --parent-self \
  --environment <environment-id> --visibility hidden \
  --provider <provider-id> --model <model-id> --reasoning-level low \
  --prompt '<task>'
```

This plugin uses the public SDK, including the host-owned `ThreadChat`. It does
not copy transcripts or change worker permissions. It adds no navigation page
and does not create or run workers itself.

```sh
vp test --project workers
vp check plugins/workers
bb plugin build plugins/workers
bb plugin install path:. --plugin workers
bb plugin reload workers
```
