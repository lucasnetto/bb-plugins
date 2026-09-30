import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SettledThread } from "../../shared/settled-contract";

type SidebarThread = PluginSidebarThread;

export function mergeSettledHistory(
  live: readonly PluginSidebarThread[],
  archived: readonly SettledThread[],
): SidebarThread[] {
  const liveIds = new Set(live.map((thread) => thread.id));

  return [
    ...live,
    ...archived.flatMap((thread): SidebarThread[] =>
      liveIds.has(thread.id)
        ? []
        : [
            {
              ...thread,
              isArchived: true,
              isPinned: false,
              isUnread: false,
              displayTitle: thread.title ?? thread.titleFallback ?? "Conversation",
              lifecycleOwnerThreadId: null,
              sourceThreadId: null,
              status: "idle",
              runtimeStatus: "idle",
              queuedWork: "none",
              pinnedAt: null,
              pinSortKey: null,
              href: `/projects/${thread.projectId}/threads/${thread.id}`,
              isHidden: false,
              parentThreadId: null,
              sectionId: null,
              originKind: null,
              originPluginId: null,
              hasPendingInteraction: false,
              indicator: "none",
              indicatorLabel: null,
              activity: {
                workflows: 0,
                backgroundAgents: 0,
                backgroundCommands: 0,
                planMode: 0,
                goals: 0,
              },
              environment: null,
              host: null,
              lastReadAt: null,
              latestAttentionAt: 0,
            },
          ],
    ),
  ];
}
