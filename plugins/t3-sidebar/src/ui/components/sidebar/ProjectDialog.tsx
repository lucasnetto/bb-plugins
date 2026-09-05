import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../../shared/rpc-contract";
import { Button } from "@/ui/components/ui/button";
import { Icon } from "@/ui/components/ui/icon";
import { usePortalScopeProps } from "@/ui/lib/portal-scope";

type Project = { id: string; name: string };
type Listing = {
  directory: string;
  parent: string | null;
  entries: { name: string; path: string }[];
};

export function ProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const portalProps = usePortalScopeProps();
  const [hosts, setHosts] = useState<Project[]>([]);
  const [hostId, setHostId] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const busy = useRef(false);
  const browse = useCallback(
    async (host: string, path?: string) => {
      const request = ++sequence.current;
      setLoading(true);
      setListing(null);
      setQuery("");
      setError(null);
      try {
        const result = await rpc.call("project_directory", {
          hostId: host,
          ...(path === undefined ? {} : { path }),
        });
        if (sequence.current === request) setListing(result);
      } catch (cause) {
        if (sequence.current === request) setError(String(cause));
      } finally {
        if (sequence.current === request) setLoading(false);
      }
    },
    [rpc],
  );
  useEffect(() => {
    let cancelled = false;
    rpc.call("project_hosts").then(
      (result) => {
        if (cancelled) return;
        setHosts(result);
        if (result[0]) {
          setHostId(result[0].id);
          void browse(result[0].id);
        } else {
          setLoading(false);
          setError("No connected machines.");
        }
      },
      (cause) => {
        if (!cancelled) {
          setError(String(cause));
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
      sequence.current++;
    };
  }, [browse, rpc]);

  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (!listing || loading) return;
      const project = await rpc.call("project_create", {
        hostId,
        path: listing.directory,
      });
      onCreated(project.id);
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const entries =
    listing?.entries.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase())) ??
    [];
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay {...portalProps} className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          {...portalProps}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border bg-background p-5 shadow-xl"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-semibold">Add project</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground">
            Choose a folder to add as a project.
          </Dialog.Description>
          <>
            <label className="flex items-center gap-2 text-sm">
              Machine
              <select
                className="min-w-0 flex-1 rounded-md border bg-background p-2"
                value={hostId}
                disabled={pending || !hosts.length}
                onChange={(event) => {
                  setHostId(event.target.value);
                  void browse(event.target.value);
                }}
              >
                {hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Parent folder"
                disabled={!listing?.parent || pending || loading}
                onClick={() => {
                  if (listing?.parent) void browse(hostId, listing.parent);
                }}
              >
                <Icon name="ChevronLeft" />
              </Button>
              <span className="min-w-0 break-all text-xs text-muted-foreground">
                {listing?.directory ?? "Choose a folder"}
              </span>
            </div>
            <input
              aria-label="Filter folders"
              placeholder="Search folders…"
              value={query}
              disabled={pending || loading}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 rounded-md border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="min-h-24 overflow-y-auto" aria-busy={loading}>
              {loading ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading folders…
                </p>
              ) : (
                entries.map((entry) => (
                  <Button
                    key={entry.path}
                    variant="ghost"
                    disabled={pending}
                    className="w-full justify-start"
                    onClick={() => void browse(hostId, entry.path)}
                  >
                    <Icon name="Folder" />
                    <span className="truncate">{entry.name}</span>
                  </Button>
                ))
              )}
              {!loading && listing && !entries.length ? (
                <p className="text-sm text-muted-foreground">
                  {query ? "No matching folders." : "No subfolders. You can add this folder."}
                </p>
              ) : null}
            </div>
            {error && hostId && !listing && !loading ? (
              <Button variant="outline" onClick={() => void browse(hostId)}>
                Retry
              </Button>
            ) : null}
          </>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!listing || loading || pending} onClick={() => void submit()}>
              {pending ? "Adding…" : "Add project"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
