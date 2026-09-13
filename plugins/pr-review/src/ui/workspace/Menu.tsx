import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../components/ui/icon";
import { usePortalScopeProps } from "../lib/portal-scope";

export function PrMenu({
  label,
  icon,
  children,
  count,
  disabled,
  compact,
}: {
  label: string;
  icon: IconName;
  children: ReactNode;
  count?: number;
  disabled?: boolean;
  compact?: boolean;
}) {
  const scope = usePortalScopeProps();

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          className={compact ? "pr-icon-button" : "pr-control"}
          aria-label={label}
          title={label}
          disabled={disabled}
        >
          <Icon name={icon} className="size-4" />
          {!compact && label}
          {!!count && <span className="pr-filter-count">{count}</span>}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          {...scope}
          className="pr-menu"
          align="end"
          sideOffset={6}
          collisionPadding={8}
        >
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function PrMenuItem({
  children,
  onSelect,
  disabled,
  icon,
  danger,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  icon?: IconName;
  danger?: boolean;
}) {
  return (
    <Menu.Item
      className={`pr-menu-item${danger ? " pr-failure" : ""}`}
      disabled={disabled}
      onSelect={onSelect}
    >
      {icon && <Icon name={icon} className="size-3.5" />}
      <span>{children}</span>
    </Menu.Item>
  );
}

export function PrMenuChoices({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const scope = usePortalScopeProps();

  return (
    <Menu.Sub>
      <Menu.SubTrigger className="pr-menu-item">
        <span>{label}</span>
        <span className="pr-menu-current">
          {options.find((option) => option.value === value)?.label}
        </span>
        <Icon name="ChevronRight" className="size-3" />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent {...scope} className="pr-menu" sideOffset={4} collisionPadding={8}>
          <Menu.Label className="pr-menu-label">{label}</Menu.Label>
          <Menu.RadioGroup value={value}>
            {options.map((option) => (
              <Menu.RadioItem
                key={option.value}
                className="pr-menu-item"
                value={option.value}
                onSelect={() => onChange(option.value)}
              >
                <span>{option.label}</span>
                <Menu.ItemIndicator className="pr-menu-indicator">
                  <Icon name="Check" className="size-3.5" />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}

export const PrMenuSeparator = () => <Menu.Separator className="pr-menu-separator" />;

export { Menu };
