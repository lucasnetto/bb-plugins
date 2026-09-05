// Shared, dependency-free constants for the server and UI.

/** Realtime channel published after every settled-map write. */
export const SETTLED_CHANGED = "settled-changed";

export const AUTO_SETTLE_OPTIONS = [
  "Never",
  "1 hour",
  "6 hours",
  "1 day",
  "3 days",
  "1 week",
] as const;
