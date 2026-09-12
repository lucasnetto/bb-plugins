Run the local Cursor SDK in BB using the **Cursor SDK** provider. It works in
your selected environment, streams text and tools into the conversation, and
keeps SDK conversations available for follow-up messages.

Choose a model from your account catalog, then use BB's reasoning controls and
Fast mode toggle. BB tools are available to the
SDK, Stop cancels its active run, and Cursor native plan mode is supported.
This version uses Full access mode; other BB approval policies are not offered.

Personal and Work use their existing dedicated Cursor credentials. The pinned
SDK runtime and conversation checkpoints stay in plugin host storage. Install
from Settings → Providers or `bb machine provider-cli install <host-id> cursor-sdk`.

Cursor ACP stays available alongside this provider. Cloud agents can follow later.
