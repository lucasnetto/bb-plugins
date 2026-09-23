import type { PluginContentScriptContext, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Result } from "./domain";

export function canShowAttention(thread: PluginSidebarThread): boolean {
  return (
    !thread.isArchived &&
    !thread.hasPendingInteraction &&
    thread.indicator === "none" &&
    Object.values(thread.activity).every((n) => n === 0)
  );
}

/** One instance per app registration/window. No DOM or cross-plugin store access. */
export function createRowBridge() {
  let setter: PluginContentScriptContext["experimental_setThreadRowStatus"];
  let desired = new Map<string, string>();
  const applied = new Set<string>();

  function clear() {
    for (const id of applied) setter?.(id, null);
    applied.clear();
  }

  function apply() {
    clear();

    if (!setter) return;

    for (const [id, label] of desired) {
      setter(id, { icon: "Eye", label, tone: "default" });
      applied.add(id);
    }
  }

  return {
    mount(context: PluginContentScriptContext) {
      setter = context.experimental_setThreadRowStatus;
      apply();

      const dispose = () => {
        clear();
        setter = undefined;
      };

      context.signal.addEventListener("abort", dispose, { once: true });

      return () => {
        context.signal.removeEventListener("abort", dispose);
        dispose();
      };
    },
    update(results: Result[], threads: readonly PluginSidebarThread[], eligible: string[]) {
      desired = new Map();

      for (const result of results) {
        const id = result.packet.threadId;
        const thread = threads.find((t) => t.id === id);

        if (
          id &&
          thread &&
          eligible.includes(id) &&
          canShowAttention(thread) &&
          result.current &&
          !result.annotation &&
          result.verdict.label
        )
          desired.set(
            id,
            `${result.packet.fixture ? "Fixture preview: " : "Jev: "}${result.verdict.label.replaceAll("_", " ")}`,
          );
      }

      apply();
    },
    reset() {
      desired.clear();
      clear();
    },
  };
}
