import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { localHostContract, localRpcContract } from "./contract";

export function registerLocalChanges(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: localHostContract });

  async function target(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });

    if (thread.environmentId) {
      const env = await bb.sdk.environments.get({ environmentId: thread.environmentId });

      if (env.path) return { root: env.path, hostId: env.hostId };
      throw new Error("This thread's environment does not have a working directory.");
    }

    const project = await bb.sdk.projects.get({ projectId: thread.projectId });
    const source = project.sources.find((entry) => entry.isDefault);

    if (!source) throw new Error("This project does not have a default directory.");

    return { root: source.path, hostId: source.hostId };
  }

  bb.rpc.register(localRpcContract, {
    localCheckoutDiff: async ({ threadId, checkout }) => {
      const { root, hostId } = await target(threadId);

      return host.call(
        "localCheckoutDiff",
        { root, checkout },
        { hostId, signal: AbortSignal.timeout(60000) },
      );
    },
    localSnapshot: async ({ threadId }) => {
      const { root, hostId } = await target(threadId);

      return host.call("localSnapshot", { root }, { hostId, signal: AbortSignal.timeout(60000) });
    },
    localDiff: async ({ threadId, ...input }) => {
      const { root, hostId } = await target(threadId);

      return host.call(
        "localDiff",
        { root, ...input },
        { hostId, signal: AbortSignal.timeout(60000) },
      );
    },
  });
}
