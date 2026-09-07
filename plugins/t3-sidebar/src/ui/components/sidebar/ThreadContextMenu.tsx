import { useRef, type ReactNode } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SidebarSection } from "@/ui/lib/sidebar-logic";
import type { ThreadRowActions } from "./ThreadRow";
import { useThreadSnoozeMenu } from "./ThreadSnoozeMenu";
import { snoozeWakeLabel } from "@/ui/lib/snooze";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/ui/components/ui/context-menu";

export function ThreadContextMenu({
  thread,
  section,
  actions,
  splitAvailable,
  onRename,
  children,
}: {
  thread: PluginSidebarThread;
  section: SidebarSection;
  actions: ThreadRowActions;
  splitAvailable: boolean;
  onRename: () => void;
  children: ReactNode;
}) {
  const renameAfterClose = useRef(false);
  const isSnoozed = section === "snoozed";
  const canSnooze = !thread.hasPendingInteraction && thread.indicator !== "waiting-for-input";
  const snoozeMenu = useThreadSnoozeMenu((until) => actions.setSnoozed(thread.id, until));
  return (
    <ContextMenu onOpenChange={snoozeMenu.onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-52"
        onCloseAutoFocus={(event) => {
          if (!renameAfterClose.current) return;
          // Let the menu release focus before mounting the inline editor.
          event.preventDefault();
          renameAfterClose.current = false;
          onRename();
        }}
      >
        <ContextMenuItem onSelect={() => actions.open(thread.id)}>Open</ContextMenuItem>
        {splitAvailable ? (
          <ContextMenuItem onSelect={() => actions.open(thread.id, { split: true })}>
            Open in split
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.setPinned(thread.id, !thread.isPinned)}>
          {thread.isPinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.setRead(thread.id, thread.isUnread)}>
          {thread.isUnread ? "Mark read" : "Mark unread"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.setSettled(thread.id, section !== "settled")}>
          {section === "settled" ? "Un-settle" : "Settle"}
        </ContextMenuItem>
        {isSnoozed ? (
          <ContextMenuItem onSelect={() => actions.setSnoozed(thread.id, null)}>
            Wake now
          </ContextMenuItem>
        ) : (
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={!canSnooze}>Snooze</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {snoozeMenu.presets.map((preset) => (
                <ContextMenuItem key={preset.id} onSelect={() => snoozeMenu.select(preset.id)}>
                  {preset.label}
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">
                    {snoozeWakeLabel(preset.until, snoozeMenu.now)}
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuItem
          onSelect={() => {
            renameAfterClose.current = true;
          }}
        >
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.archive(thread.id)}>Archive</ContextMenuItem>
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => actions.requestDelete(thread.id)}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
