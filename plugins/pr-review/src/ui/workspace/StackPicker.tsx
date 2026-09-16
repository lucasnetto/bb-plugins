import type { PrStack } from "../../shared/workspace-contract";
import { Icon } from "../components/ui/icon";
import { usePortalScopeProps } from "../lib/portal-scope";
import { Menu } from "./Menu";
import { PrGlyph } from "./presentation";

export function StackPicker({
  stack,
  number,
  onSelect,
}: {
  stack: PrStack;
  number: number;
  onSelect: (url: string) => void;
}) {
  const scope = usePortalScopeProps();
  const position = stack.layers.findIndex((layer) => layer.number === number) + 1;

  if (!position) return null;
  const label = `Stack #${stack.number}, layer ${position} of ${stack.layers.length}`;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" className="pr-control" aria-label={label} title={label}>
          <Icon name="Layers" className="size-3.5" />
          {position}/{stack.layers.length}
          <Icon name="ChevronDown" className="size-3" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          {...scope}
          className="pr-menu pr-stack-picker"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label={`Stack #${stack.number}`}
        >
          <Menu.Group>
            <Menu.Label className="pr-menu-label">Stack #{stack.number}</Menu.Label>
            <Menu.RadioGroup value={String(number)}>
              {[...stack.layers].reverse().map((layer) => (
                <Menu.RadioItem
                  key={layer.number}
                  value={String(layer.number)}
                  className="pr-menu-item pr-stack-option"
                  textValue={`#${layer.number} ${layer.title} ${layer.headRefName}`}
                  onSelect={() => {
                    if (layer.number !== number) onSelect(layer.url);
                  }}
                >
                  <PrGlyph state={layer.state} draft={layer.isDraft} />
                  <span className="pr-stack-option-text">
                    <span className="truncate" title={layer.title}>
                      {layer.title}
                    </span>
                    <span className="pr-muted truncate" title={layer.headRefName}>
                      #{layer.number} · {layer.headRefName}
                    </span>
                  </span>
                  <Menu.ItemIndicator>
                    <Icon name="Check" className="size-3.5" />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Group>
          <Menu.Separator className="pr-menu-separator" />
          <div className="pr-stack-base">
            <Icon name="GitBranch" className="size-3.5" />
            <code>{stack.base}</code>
          </div>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
