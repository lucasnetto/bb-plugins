"""Read administrative configuration from the Profiles plugin settings."""
import json
import os
from pathlib import Path
import shutil
import subprocess
from urllib.parse import urlsplit

PROFILE_IDS = ('personal', 'work')


def load_settings():
    supplied = os.environ.get('BB_PROFILES_CONFIG')
    if supplied:
        return json.loads(supplied)
    executable = os.environ.get('BB_CLI') or shutil.which('bb')
    try:
        if not executable:
            raise RuntimeError('BB CLI is unavailable')
        result = subprocess.run([executable, 'plugin', 'config', 'profiles', '--json'],
                                capture_output=True, text=True, timeout=5, check=True)
        return json.loads(result.stdout)['values']
    except (OSError, RuntimeError, subprocess.SubprocessError):
        snapshot = Path.home() / '.cache/bb-profiles/administration.json'
        if not snapshot.exists():
            raise RuntimeError('Open the Profiles plugin page and configure profile addresses before using this helper.') from None
        return json.loads(snapshot.read_text())


def permanent_source(root=None):
    root = (root or Path(__file__).resolve().parents[2]).resolve()
    result = subprocess.run(['git', '-C', str(root), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                            capture_output=True, text=True, timeout=10, check=True)
    if not (root / '.git').is_dir() or Path(result.stdout.strip()).resolve() != root / '.git':
        raise RuntimeError('Run from the main repository checkout; never install from a task worktree.')
    return root


def desktop_contents():
    executable = os.environ.get('BB_CLI')
    if executable:
        for parent in Path(executable).resolve().parents:
            if parent.name == 'Contents' and parent.parent.suffix == '.app':
                return parent
    return Path('/Applications/bb.app/Contents')


def profile_urls(settings, hosts=None):
    urls = {}
    for profile in PROFILE_IDS:
        value = settings.get(profile + 'LocalUrl', '')
        parsed = urlsplit(value)
        if (parsed.scheme not in ('http', 'https') or parsed.hostname not in ('localhost', '127.0.0.1', '::1')
                or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/')):
            raise RuntimeError('Set both loopback local URLs on the Profiles plugin page.')
        urls[profile] = value.rstrip('/')
    if urls['personal'] == urls['work'] and (not hosts or hosts['personal'] == hosts['work']):
        raise RuntimeError('Personal and Work must use different local URLs.')
    return urls
