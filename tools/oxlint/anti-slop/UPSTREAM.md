# anti-slop provenance

- Source: https://github.com/dmmulroy/anti-slop
- Revision: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Copied from: `skills/install-anti-slop/assets/anti-slop/` using the upstream installer. These are the production `src/` files, without upstream tests.
- Generic entry point: `tools/oxlint/anti-slop/index.ts`
- Effect entry point: `tools/oxlint/anti-slop/effect/index.ts`
- Local deviations: none in rule source. Added this provenance file and the upstream root MIT `LICENSE`; preserved the nested ESLint Stylistic license and provenance.

Both plugins and all their rules are enabled as errors in `vite.config.ts`, along with native `oxc/no-accumulating-spread`. Vendored code and agent tooling are excluded from lint and formatting. `@oxlint/plugins` is pinned in the workspace catalog to 1.79.0, matching the Oxlint version supplied by Vite+; keep these versions aligned when upgrading Vite+.

Run `pnpm lint`, `pnpm typecheck`, and `pnpm check` to validate. Installation intentionally does not refactor existing application code or suppress its findings. For future upstream updates, preserve local changes and use this revision as the three-way merge base rather than overwriting the directory.
