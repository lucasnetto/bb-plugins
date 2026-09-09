# Plugin workflow

- When finishing work on a plugin, always refresh it in both the Personal and Work profiles. If the work includes UI changes, ask the user for permission before using computer use, then test the UI with computer use once permission is granted.
- Run plugin UI checks in a temporary instance using `python3 scripts/bb-test.py start --plugin <plugin-directory>` and BB Browser Automation (`--backend local --headless`), following the README's "Isolated UI testing" workflow. Give each concurrent test its own instance.
- Use `python3 scripts/bb-test.py bb <directory> ...` for commands targeting the temporary instance; keep the agent's own BB routing unchanged. Close the browser session and stop the instance in cleanup, including on failure. Ask before falling back to a visible browser or the user's active bb window.
