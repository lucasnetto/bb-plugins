# Model Thinking Level

Keeps the selected model's thinking level visible next to its name in BB's
composer, including narrow panes and mobile layouts.

BB already renders and updates this label, but hides it in compact composers.
This plugin overrides only that hiding rule. It uses BB's own provider labels
and shows no extra label for models without a reasoning option.

This is independent of Hide Models and requires no configuration. Disabling
or removing the plugin restores BB's normal responsive behavior.

Build with `bb plugin build plugins/model-thinking-level`, then install from
the repository root with `bb plugin install path:. --plugin model-thinking-level`.
The content script keeps its CSS active; BB owns stylesheet cleanup on reload
and disable. The selector targets BB 0.42's model picker markup, so check it
after BB updates.
