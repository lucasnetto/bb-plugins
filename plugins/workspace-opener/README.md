# Workspace Opener

BB’s existing Open in Cursor / VS Code action opens the single `.code-workspace`
file directly inside the selected folder. With zero or multiple workspace files,
it opens the folder as usual. Local Cursor opens, including file/line targets, use `--classic` to force the IDE
instead of Glass. Terminal/Finder actions retain their behavior. No project configuration is needed.

The plugin resolves files through its host worker: the local helper identifies
the client machine, while SSH requests identify the remote machine. The owning
machine must be enrolled in the current BB instance. Lookup errors or a 2.5-second
timeout fall back to BB’s original request for VS Code and SSH targets. Local
Cursor launch failures report an error instead of retrying through Glass.

## Compatibility

BB currently has no editor-target override API. A trusted frontend content script
wraps `window.fetch` for the loopback helper’s `POST /open-in-target` request only.
This internal request adapter may need updating after BB upgrades. Unknown request
formats pass through unchanged. Disable the plugin to restore normal behavior;
reload/disposal removes its wrapper. No BB core files are modified.

The resolver checks direct children only, follows workspace-file symlinks, and
leaves directories with over 10,000 entries unchanged. It does not parse workspace
contents; the selected editor validates them.

## Verification

`node --experimental-strip-types --test plugins/workspace-opener/*.test.ts`

From the permanent bb-plugins checkout, run `bb profiles refresh workspace-opener
--install-missing` and `bb profiles refresh workspace-opener --check`.

Local Cursor launches run on the client machine through the plugin host worker.
On macOS, Cursor.app is discovered in `/Applications` or `~/Applications`.
SSH opens still use BB’s existing launcher; IDE forcing currently applies to local opens.
