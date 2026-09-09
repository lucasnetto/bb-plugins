// Adapted from T3 Code. See T3-LICENSE.
export const DIFF_SURFACE_THEME_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: var(--code-background) !important;
  --diffs-light-bg: var(--code-background) !important;
  --diffs-dark-bg: var(--code-background) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  /* Gutter, context, and row tints all derive from the code surface the diff
     body sits on — mixing from the canvas leaves the gutter looking unthemed
     when a palette separates the two. */
  --diffs-bg-context-override: color-mix(in srgb, var(--code-background) 97%, var(--code-foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--code-background) 94%, var(--code-foreground));
  --diffs-bg-separator-override: color-mix(
    in srgb,
    var(--code-background) 95%,
    var(--code-foreground)
  );
  --diffs-bg-buffer-override: color-mix(in srgb, var(--code-background) 90%, var(--code-foreground));

  /* Dedicated diff accents stay legible when a theme's status colors are muted.
     Pierre mixes the row/gutter accents below with the code surface itself. */
  --diffs-addition-color-override: light-dark(#16803c, #3fb950);
  --diffs-deletion-color-override: light-dark(#cf222e, #f47067);
  --diffs-fg-number-addition-override: light-dark(#116329, #aff5b4);
  --diffs-fg-number-deletion-override: light-dark(#82071e, #ffdcd7);
  --diffs-bg-addition-emphasis-override: color-mix(
    in srgb,
    var(--code-background) 50%,
    var(--diffs-addition-color-override)
  );
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--code-background) 50%,
    var(--diffs-deletion-color-override)
  );

  background-color: var(--diffs-bg) !important;
  color: var(--code-foreground) !important;
}

/* Set Pierre's mix weights instead of passing already mixed colors as its
   targets: that diluted dark rows a second time (30% accent down to ~6%).
   Hover and selection continue through Pierre's normal composition pipeline. */
[data-background] :is([data-line], [data-no-newline]):is(
  [data-line-type="change-addition"],
  [data-line-type="change-deletion"]
) {
  --mix-light: 75%;
  --mix-dark: 70%;
}

[data-background] :is([data-column-number], [data-gutter-buffer]):is(
  [data-line-type="change-addition"],
  [data-line-type="change-deletion"]
) {
  --mix-light: 65%;
  --mix-dark: 60%;
}
`;
