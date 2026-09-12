#!/usr/bin/env python3
"""Refresh local bb-plugins plugins in both profiles without switching agent context."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

PROFILES = {'personal': 38886, 'work': 48886}
PERMANENT = Path.home() / 'Developer/lucasnetto/bb-plugins'


def cli(arguments, profile=None):
    env = dict(os.environ)
    # Administrative plugin commands only. Never run threads or provider logins
    # through this helper, and never modify the invoking process's environment.
    for key in ('BB_THREAD_ID', 'BB_PROJECT_ID', 'BB_ENVIRONMENT_ID'):
        env.pop(key, None)
    if profile:
        env['BB_SERVER_URL'] = f'http://127.0.0.1:{PROFILES[profile]}'
    executable = os.environ.get('BB_CLI') or shutil.which('bb')
    if not executable:
        raise RuntimeError('BB CLI missing; restore bb on PATH.')
    result = subprocess.run([executable, 'plugin', *arguments], env=env,
                            capture_output=True, text=True, timeout=300)
    if result.returncode:
        # Do not relay arbitrary plugin output, which may contain account data.
        raise RuntimeError(f'plugin {arguments[0]} failed (exit {result.returncode}); inspect bb plugin logs for this profile.')
    return result.stdout


def build_hash(source):
    digest = hashlib.sha256()
    files = [source / 'package.json']
    for directory in ('dist', 'skills'):
        files.extend(p for p in (source / directory).rglob('*') if p.is_file())
    for path in sorted(files):
        digest.update(str(path.relative_to(source)).encode() + b'\0' + path.read_bytes() + b'\0')
    return digest.hexdigest()[:16]


def refresh(root, ids, check=False, run=cli):
    sources = {}
    for manifest in (root / 'plugins').glob('*/package.json'):
        name = json.loads(manifest.read_text())['name']
        if name.startswith('bb-plugin-'):
            sources[name.removeprefix('bb-plugin-')] = manifest.parent
    unknown = set(ids) - sources.keys()
    if unknown:
        raise RuntimeError('Unknown local plugins: ' + ', '.join(sorted(unknown)))
    inventories, errors, rows, builds = {}, [], [], {}
    for profile in PROFILES:
        try:
            inventories[profile] = json.loads(run(['list', '--json'], profile))['plugins']
        except Exception as error:
            errors.append(f'{profile}: unavailable ({type(error).__name__}); start the profile and retry.')
    for profile, plugins in inventories.items():
        selected = [p for p in plugins if p['id'] in sources and (not ids or p['id'] in ids)]
        for plugin_id in set(ids) - {p['id'] for p in selected}:
            errors.append(f'{profile}/{plugin_id}: not installed; install it explicitly before refresh.')
        for plugin in selected:
            plugin_id = plugin['id']
            source = sources[plugin_id]
            expected = 'path:' + str(source)
            try:
                if not check:
                    if plugin_id not in builds:
                        try:
                            run(['build', str(source)])
                            builds[plugin_id] = True
                        except Exception:
                            builds[plugin_id] = False
                    if not builds[plugin_id]:
                        raise RuntimeError('build failed; fix the build before retrying')
                    if plugin['source'] != expected:
                        run(['install', expected, '--yes'], profile)
                        if not plugin['enabled']:
                            run(['disable', plugin_id], profile)
                    else:
                        run(['reload', plugin_id], profile)
                current = next(p for p in json.loads(run(['list', '--json'], profile))['plugins'] if p['id'] == plugin_id)
                healthy = current['source'] == expected and current['enabled'] == plugin['enabled'] and (not current['enabled'] or current['status'] == 'running')
                rows.append({'profile': profile, 'plugin': plugin_id, 'source': current['source'],
                             'installationPath': current['rootDir'], 'version': current['version'],
                             'build': build_hash(source), 'bundle': (current.get('app', {}).get('bundle') or {}).get('hash'),
                             'enabled': current['enabled'], 'status': current['status'], 'healthy': healthy})
                if not healthy:
                    errors.append(f'{profile}/{plugin_id}: source, enabled state, or health did not match; inspect this profile.')
            except Exception as error:
                errors.append(f'{profile}/{plugin_id}: {error}' if isinstance(error, RuntimeError) else f'{profile}/{plugin_id}: {type(error).__name__}; inspect plugin logs.')
    return {'mode': 'check' if check else 'refresh', 'plugins': rows, 'errors': errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plugins', nargs='*')
    parser.add_argument('--check', action='store_true', help='report paths, builds and health without refreshing')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    if root != PERMANENT.resolve():
        parser.error(f'Run from the permanent source at {PERMANENT}; never install from a task checkout.')
    lock_path = Path(tempfile.gettempdir()) / f'bb-plugins-profile-refresh-{os.getuid()}.lock'
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('A profile refresh is already running; wait for its result.')
        try:
            result = refresh(root, args.plugins, args.check)
        except RuntimeError as error:
            parser.error(str(error))
        print(json.dumps(result, indent=2))
        return int(bool(result['errors']))


if __name__ == '__main__':
    raise SystemExit(main())
