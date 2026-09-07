import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/ui/components/ui/button";
import { usePortalScopeProps } from "@/ui/lib/portal-scope";

export function RemoveProjectDialog({
  open,
  onOpenChange,
  projectName,
  pending,
  error,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string | undefined;
  pending: boolean;
  error: string | null;
  onRemove: () => Promise<void>;
}) {
  const portalProps = usePortalScopeProps();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay {...portalProps} className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          {...portalProps}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl"
        >
          <Dialog.Title className="text-base font-semibold">Remove project?</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm text-muted-foreground">
            Remove “{projectName}” and all of its threads? This cannot be undone.
          </Dialog.Description>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => void onRemove()}>
              {pending ? "Removing…" : "Confirm removal"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
