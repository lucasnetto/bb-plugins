# Ocean Theme

T3 Code's Ocean palette mapped to BB's public theme tokens. Includes light and
dark modes, slate surfaces, blue selection/focus accents, and teal primary
actions. No layout, font, artwork, or glass-effect changes. Terminal ANSI and
syntax highlighting retain BB defaults; status greens and purples use Tailwind
semantic colors where Ocean has no equivalent role.

Select **Ocean (T3 Code)** under Settings → Appearance, or run:

```sh
bb theme set plugin:ocean-theme:ocean
```

The palette is server-wide; light/dark mode remains a per-client preference.
To restore the previous Personal palette: `bb theme set codex-night-owl`.

From the permanent bb-plugins checkout:

```sh
node --test plugins/ocean-theme/theme.test.mjs
bb profiles refresh ocean-theme --install-missing
bb profiles refresh ocean-theme --check
```

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream attribution.
