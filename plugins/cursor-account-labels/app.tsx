import { definePluginApp } from "@get-bb/plugin-sdk/app";

type ProviderIconProps = {
  className?: string;
};

const cursorPath =
  "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23";

function AccountIcon({
  badge,
  badgeColor,
  className,
  label,
}: ProviderIconProps & {
  badge: "P" | "W";
  badgeColor: string;
  label: string;
}) {
  return (
    <svg
      aria-label={label}
      className={className}
      role="img"
      viewBox="0 0 24 24"
    >
      <path d={cursorPath} fill="currentColor" />
      <circle
        cx="17.25"
        cy="17.25"
        r="6"
        fill={badgeColor}
        stroke="var(--background)"
        strokeWidth="1.5"
      />
      {badge === "W" ? (
        <path
          d="m14.9 15.65 1.15 5.05h1.35l.85-2.95.85 2.95h1.35l1.15-5.05h-1.2l-.72 3.45-.86-3.45h-1.14l-.86 3.45-.72-3.45H14.9Z"
          fill="white"
          transform="translate(17.25 17.25) scale(1.15) translate(-18.25 -18.25)"
        />
      ) : (
        <path
          d="M16.05 15.55h2.55c1.45 0 2.4.82 2.4 2.1 0 1.3-.95 2.12-2.4 2.12h-1.25v1h-1.3v-5.22Zm1.3 1.1v2.02h1.12c.75 0 1.2-.35 1.2-1.01 0-.65-.45-1.01-1.2-1.01h-1.12Z"
          fill="white"
          transform="translate(17.25 17.25) scale(1.15) translate(-18.25 -18.25)"
        />
      )}
    </svg>
  );
}

function WorkIcon({ className }: ProviderIconProps) {
  return (
    <AccountIcon
      badge="W"
      badgeColor="#2563eb"
      className={className}
      label="Cursor Work"
    />
  );
}

function PersonalIcon({ className }: ProviderIconProps) {
  return (
    <AccountIcon
      badge="P"
      badgeColor="#9333ea"
      className={className}
      label="Cursor Personal"
    />
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_providerIcon({
    providerId: "acp-cursor-work",
    icon: WorkIcon,
  });

  app.slots.experimental_providerIcon({
    providerId: "acp-cursor-personal",
    icon: PersonalIcon,
  });
});
