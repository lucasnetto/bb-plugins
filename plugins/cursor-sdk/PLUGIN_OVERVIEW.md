Run Cursor locally or in the cloud using the **Cursor SDK** provider. Local execution works in
your selected environment, streams text and tools into the conversation, and
keeps SDK conversations available for follow-up messages.

Choose a model from your account catalog, then use BB's reasoning controls and
Fast mode toggle. BB tools are available to the
SDK, Stop cancels its active run, and Cursor native plan mode is supported.
This version uses Full access mode; other BB approval policies are not offered.

Personal and Work use their existing dedicated Cursor credentials. The pinned
SDK runtime and conversation checkpoints stay in plugin host storage. Install
from Settings → Providers or `bb machine provider-cli install <host-id> cursor-sdk`.

Use the **cloud** switch in the New thread
composer with Cursor SDK selected to choose where new conversations run. It updates the same shared
profile default as **Cloud agents** in plugin settings. Open windows stay in sync.
Existing threads
keep their original runtime. Cloud starts from a clean, pushed GitHub commit.
It shares the model controls, streams replies into BB, and links to the remote
agent and branches. Stop cancels cloud work; closing BB leaves it running.
Follow-ups retain the same cloud conversation. After reconnecting to an active
run, use its Cursor link until it finishes, then retry the follow-up.

Cloud requires repository access in Cursor. Local BB tools and environment
variables stay on the host; configure remote tools and credentials in Cursor.
Automatic PR creation is off. Cursor ACP remains available alongside Cursor SDK.
