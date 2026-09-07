import { useState } from "react";
import { snoozePresets, snoozeWakeLabel } from "@/ui/lib/snooze";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/ui/components/ui/dropdown-menu";

export function useThreadSnoozeMenu(onSnooze: (until: number) => void) {
  const [now, setNow] = useState(() => Date.now());
  return {
    now,
    presets: snoozePresets(new Date(now)),
    onOpenChange: (open: boolean) => {
      if (open) setNow(Date.now());
    },
    select: (id: string) => {
      // Resolve relative deadlines when selected, even if the menu has been open for a while.
      const preset = snoozePresets(new Date()).find((item) => item.id === id);
      if (preset) onSnooze(preset.until);
    },
  };
}

export function ThreadSnoozeMenu({ onSnooze }: { onSnooze: (until: number) => void }) {
  const menu = useThreadSnoozeMenu(onSnooze);
  return (
    <DropdownMenu onOpenChange={menu.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Snooze thread"
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className="inline-flex items-center rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Snooze
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {menu.presets.map((preset) => (
          <DropdownMenuItem key={preset.id} onSelect={() => menu.select(preset.id)}>
            {preset.label}
            <span className="ml-auto pl-3 text-xs text-muted-foreground">
              {snoozeWakeLabel(preset.until, menu.now)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
