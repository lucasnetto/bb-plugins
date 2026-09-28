#!/usr/bin/env python3
"""Refresh installed plugins in both profiles without switching agent context."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys

from configuration import PROFILE_IDS, load_settings, profile_urls

PROFILES = PROFILE_IDS


def cli(arguments, profile=None, urls=None):
    env = dict(os.environ)
    # Administrative plugin commands only. Never run threads or provider logins
    # through this helper, and never modify the invoking process's environment.
    for key in ('BB_THREAD_ID', 'BB_PROJECT_ID', 'BB_ENVIRONMENT_ID'):
        env.pop(key, None)
    if profile:
        env['BB_SERVER_URL'] = urls[profile]
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


def local_directory(plugin):
    # rootDir is the selected package, including for collection/subdirectory installs.
    source = Path(plugin['rootDir'])
    if not source.is_absolute() or not (source / 'package.json').is_file():
        raise RuntimeError('local source is missing; register its permanent directory with bb plugin install path:<directory>')
    source = source.resolve()
    repository = subprocess.run(
        ['git', '-C', str(source), 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
        capture_output=True, text=True, timeout=10,
    )
    if repository.returncode == 0:
        git_dir, common_dir = repository.stdout.strip().splitlines()
        if Path(git_dir).resolve() != Path(common_dir).resolve():
            raise RuntimeError('local source is a task worktree; register its permanent directory before refreshing')
    elif 'not a git repository' not in repository.stderr:
        raise RuntimeError('cannot verify the local source checkout; inspect its Git configuration')
    return source


def same_installation(current, expected):
    return all(current.get(key) == expected.get(key) for key in ('source', 'rootDir', 'enabled'))


def refresh(ids, check=False, run=cli, install_missing=False, source_override=None):
    if install_missing and (check or not ids):
        raise RuntimeError("--install-missing requires explicit plugin IDs and cannot be used with --check")
    transport = getattr(run, 'inspect_source', None)
    if transport and (source_override is not None or install_missing) and len(set(run.hosts.values())) > 1:
        raise RuntimeError('--source and --install-missing require profiles on the same machine; install a source explicitly on its owning machine first')
    destination = None
    if source_override is not None:
        if len(ids) != 1 or check or install_missing:
            raise RuntimeError('--source requires exactly one plugin ID and cannot be used with --check or --install-missing')
        if transport:
            info = transport(str(source_override), PROFILES[0])
            destination = Path(info['path'])
            manifest = {'name': info['name']}
        else:
            destination = local_directory({'rootDir': str(source_override)})
            manifest = json.loads((destination / 'package.json').read_text())
        if manifest.get('name', '').rsplit('/', 1)[-1] != 'bb-plugin-' + ids[0]:
            raise RuntimeError('--source package identity does not match the requested plugin ID')
    inventories, errors, rows, builds = {}, [], [], {}
    for profile in PROFILES:
        try:
            inventories[profile] = json.loads(run(['list', '--json'], profile))['plugins']
        except Exception as error:
            errors.append(f'{profile}: unavailable ({type(error).__name__}); start the profile and retry.')
    # Refresh the coordinating instance last: self-reload disposes its remote host clients.
    for profile, plugins in sorted(inventories.items(), key=lambda item: item[0] == getattr(run, 'current_profile', None)):
        selected = [(p, False) for p in plugins if not ids or p['id'] in ids]
        for plugin_id in sorted(set(ids) - {p['id'] for p in plugins}):
            if install_missing:
                candidates = [p for inventory in inventories.values() for p in inventory if p['id'] == plugin_id]
                if len(candidates) == 1 and candidates[0]['source'].startswith('path:'):
                    selected.append((candidates[0], True))
                else:
                    errors.append(f'{profile}/{plugin_id}: no unique installed local source; install the plugin explicitly in this profile first.')
            else:
                errors.append(f'{profile}/{plugin_id}: not installed; --install-missing can copy a local installation from the other profile.')
        # The helper is an independent process; reload its owning plugin last.
        selected.sort(key=lambda item: (item[0]['id'] == 'profiles', item[0]['id']))
        for plugin, missing in selected:
            plugin_id = plugin['id']
            row = {'profile': profile, 'hostId': run.hosts[profile] if transport else None, 'plugin': plugin_id, 'source': plugin['source'],
                   'installationPath': plugin['rootDir'], 'version': plugin.get('version'),
                   'build': None, 'bundle': None, 'enabled': plugin['enabled'],
                   'status': plugin.get('status'), 'healthy': False}
            rows.append(row)
            try:
                kind = plugin['source'].split(':', 1)[0]
                if kind not in ('path', 'git', 'npm', 'builtin'):
                    raise RuntimeError('unsupported plugin source; refresh it explicitly with bb plugin reload')
                if destination is not None and kind != 'path':
                    raise RuntimeError('--source can only move an existing local path installation')
                if kind == 'path' and transport:
                    info = transport(str(destination or plugin['rootDir']), profile)
                    source = Path(info['path'])
                else:
                    source = destination if destination is not None else local_directory(plugin) if kind == 'path' else Path(plugin['rootDir'])
                build_key = (run.hosts[profile], str(source)) if transport else source
                if not check:
                    if kind == 'path' and build_key not in builds:
                        try:
                            run(['build', str(source)], profile) if transport else run(['build', str(source)])
                            builds[build_key] = True
                        except Exception:
                            builds[build_key] = False
                    if kind == 'path' and not builds[build_key]:
                        raise RuntimeError('build failed; fix the build before retrying')
                    before = next((p for p in json.loads(run(['list', '--json'], profile))['plugins'] if p['id'] == plugin_id), None)
                    if missing:
                        if before is not None:
                            raise RuntimeError('installation changed during refresh; retry')
                        run(['install', 'path:' + str(source), '--yes'], profile)
                        if not plugin['enabled']:
                            run(['disable', plugin_id], profile)
                    elif before is None or not same_installation(before, plugin):
                        raise RuntimeError('installation changed during refresh; retry')
                    elif destination is not None and (plugin['source'] != 'path:' + str(source) or plugin['rootDir'] != str(source)):
                        run(['install', 'path:' + str(source), '--yes'], profile)
                        if not plugin['enabled']:
                            run(['disable', plugin_id], profile)
                    elif plugin['enabled']:
                        run(['reload', plugin_id], profile)
                current = plugin if check else next(p for p in json.loads(run(['list', '--json'], profile))['plugins'] if p['id'] == plugin_id)
                expected = {**plugin, 'source': 'path:' + str(source), 'rootDir': str(source)} if missing or destination is not None else plugin
                healthy = (same_installation(current, expected)
                           and (current['status'] == ('running' if current['enabled'] else 'disabled'))
                           and (kind == 'path' or current['version'] == plugin['version']))
                row.update(source=current['source'], installationPath=current['rootDir'], version=current['version'],
                           build=(transport(str(source), profile)['hash'] if kind == 'path' else None) if transport else build_hash(source) if (source / 'package.json').is_file() else None,
                           bundle=(current.get('app', {}).get('bundle') or {}).get('hash'),
                           enabled=current['enabled'], status=current['status'], healthy=healthy)
                if not healthy:
                    raise RuntimeError('source, enabled state, managed version, or health did not match; inspect this profile')
            except Exception as error:
                row['healthy'] = False
                row['error'] = str(error) if isinstance(error, RuntimeError) else f'{type(error).__name__}; inspect plugin logs.'
                errors.append(f'{profile}/{plugin_id}: {row["error"]}')
    return {'mode': 'check' if check else 'refresh', 'plugins': rows, 'errors': errors}


class HostRunner:
    """Private JSON-lines channel to the owning plugin, which selects enrolled machines."""
    def __init__(self, hosts, current_profile=None):
        self.hosts = hosts
        self.current_profile = current_profile

    def request(self, profile, action, argument=''):
        print(json.dumps({'request': {'profile': profile, 'action': action, 'argument': argument}}), flush=True)
        response = json.loads(sys.stdin.readline())
        if 'error' in response:
            raise RuntimeError(response['error'])
        return response['value']

    def inspect_source(self, path, profile):
        return json.loads(self.request(profile, 'inspect', path))

    def __call__(self, args, profile=None):
        if profile not in self.hosts:
            raise RuntimeError('Missing maintenance machine')
        action = args[0]
        argument = args[1] if len(args) > 1 and action != 'list' else ''
        if action == 'install':
            argument = argument.removeprefix('path:')
        return self.request(profile, action, argument)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plugins', nargs='*')
    parser.add_argument('--check', action='store_true', help='report paths, builds and health without refreshing')
    parser.add_argument('--install-missing', action='store_true', help='copy explicitly named local plugins from the other profile when absent')
    parser.add_argument('--source', help='move one installed local plugin to this absolute permanent package directory in both profiles')
    args = parser.parse_args()
    settings = load_settings()
    host_transport = os.environ.get('BB_PROFILES_HOST_TRANSPORT') == '1'
    hosts = json.loads(os.environ['BB_PROFILES_HOSTS']) if host_transport else None
    urls = profile_urls(settings, hosts)
    runner = HostRunner(hosts, settings.get('refreshCurrentProfile')) if host_transport else lambda arguments, profile=None: cli(arguments, profile, urls)
    lock_path = Path(tempfile.gettempdir()) / f'bb-plugins-profile-refresh-{os.getuid()}.lock'
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('A profile refresh is already running; wait for its result.')
        try:
            result = refresh(args.plugins, args.check, run=runner, install_missing=args.install_missing, source_override=args.source)
        except RuntimeError as error:
            parser.error(str(error))
        print(json.dumps({'result': result}) if host_transport else json.dumps(result, indent=2))
        return int(bool(result['errors']))


if __name__ == '__main__':
    raise SystemExit(main())
