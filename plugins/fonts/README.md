# BB Fonts

Choose **BB Fonts** in BB Settings. Select separate fonts for the interface
(navigation, conversations and controls) and code (code blocks, diffs and file
paths). The preview shows the saved selection. Changes save automatically and
apply to open windows in the current profile.

Pick a preset, or choose **Custom** and enter an installed font family, such as
`Avenir Next` or `JetBrains Mono`. Enter one family name without quotes or CSS.
Fonts must be available on each device displaying BB; missing fonts use the
fallback. The plugin does not download fonts or change font sizes. Embedded
pages and surfaces that specify their own font independently are unaffected.

Select **BB default** to restore the current theme's font for either category.
Disabling or removing the plugin restores both. Installing the plugin starts
with BB defaults and does not change your appearance until you choose a font.
Personal and Work keep their selections independently.

You can also use BB's standard configuration commands:

```sh
bb plugin config bb-fonts
bb plugin config bb-fonts set interfaceFont 'System UI'
bb plugin config bb-fonts set codeFont Menlo
bb plugin config bb-fonts set customInterfaceFont 'Avenir Next'
bb plugin config bb-fonts set interfaceFont Custom
bb plugin config bb-fonts set interfaceFont 'BB default'
bb plugin config bb-fonts set codeFont 'BB default'
```

Build and install from the repository root:

```sh
vp run --filter bb-plugin-bb-fonts build
bb plugin install path:. --plugin bb-fonts
```

The plugin uses BB's declarative settings and an app-wide React slot to apply
the `--font-sans` and `--font-mono` theme tokens, plus the source/diff viewer's
`--diffs-font-family` and `--diffs-header-font-family` tokens. These inherited
properties also reach the viewer's shadow DOM. Its stylesheet is removed when
the slot unmounts. It does not modify the active palette or theme files.
