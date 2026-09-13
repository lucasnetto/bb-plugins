#!/usr/bin/python3
"""Restart Personal and Work bb services after an update, then wait for readiness."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

PERMANENT = Path.home() / 'Developer/lucasnetto/bb-plugins'
APP = Path('/Applications/bb.app/Contents')
PACKAGE = APP / 'Resources/app.asar.unpacked/node_modules/bb-app'
PROFILES = {'personal': 38886, 'work': 48886}


def launchctl(*args):
    return subprocess.run(['/bin/launchctl', *args], capture_output=True,
                          text=True, timeout=15, check=True).stdout


def service_target(profile):
    label = f'com.orbisa.bb-{profile}'
    plist = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
    config = plistlib.loads(plist.read_bytes())
    expected = ['/usr/bin/python3', str(Path.home() / '.local/libexec/bb-profile-service.py'), profile]
    if config.get('ProgramArguments') != expected or config.get('KeepAlive') is not True:
        raise RuntimeError('unexpected service configuration; refusing restart')
    return f'gui/{os.getuid()}/{label}'


def service_pid(target):
    status = launchctl('print', target)
    match = re.search(r'^\s*pid = (\d+)\s*$', status, re.MULTILINE)
    return int(match.group(1)) if match else None


def installed_bundle():
    version = json.loads((PACKAGE / 'package.json').read_text())['version']
    paths = [APP / 'MacOS/bb', APP / 'Resources/app.asar',
             PACKAGE / 'package.json', PACKAGE / 'dist/bb-app.js',
             PACKAGE / 'server/dist/start-server.js',
             PACKAGE / 'host-daemon/dist/daemon-bundle.mjs']
    stats = [path.stat() for path in paths]
    if not version or any(not stat.st_size for stat in stats):
        raise RuntimeError('bb installation is incomplete; wait for the update to finish')
    return version, [(s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns) for s in stats]


def ready(profile, target, previous_pid, version):
    pid = service_pid(target)
    if pid is None or pid == previous_pid:
        return False
    # Only these fixed local services are queried; no account environment changes.
    url = f'http://127.0.0.1:{PROFILES[profile]}/api/v1/system/version'
    with urllib.request.urlopen(url, timeout=2) as response:
        return json.load(response).get('currentVersion') == version


def restart_profile(profile, bundle, timeout=60):
    target = service_target(profile)
    previous_pid = service_pid(target)
    if previous_pid is None:
        raise RuntimeError('service is not running; start the profile first')
    if installed_bundle() != bundle:
        raise RuntimeError('bb changed during this command; retry after the update finishes')
    print(f'{profile}: restarting…', flush=True)
    launchctl('kill', 'SIGTERM', target)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if installed_bundle() != bundle:
            raise RuntimeError('bb changed during restart; retry after the update finishes')
        try:
            if ready(profile, target, previous_pid, bundle[0]):
                print(f'{profile}: ready (bb {bundle[0]})', flush=True)
                return
        except (OSError, ValueError, subprocess.SubprocessError):
            # The launcher and HTTP listener temporarily disappear during restart.
            pass
        time.sleep(0.5)
    data = '.bb' if profile == 'personal' else '.bb-work'
    raise RuntimeError(f'not ready after {timeout}s; inspect ~/{data}/logs/profile-service*.log')


def install():
    source = Path(__file__).resolve()
    if source.parents[2] != PERMANENT.resolve():
        raise RuntimeError(f'Install from the permanent source at {PERMANENT}')
    destination = Path.home() / '.local/bin/bb-restart'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink() and destination.resolve() == source:
        print(f'Already installed: {destination}')
        return
    if destination.exists() or destination.is_symlink():
        raise RuntimeError(f'{destination} already exists; refusing to replace it')
    source.chmod(source.stat().st_mode | 0o111)
    destination.symlink_to(source)
    print(f'Installed {destination}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile', nargs='?', choices=('all', *PROFILES), default='all',
                        help='profile to restart (default: both)')
    parser.add_argument('--install', action='store_true', help='install bb-restart on PATH')
    args = parser.parse_args()
    if args.install:
        install()
        return 0
    selected = PROFILES if args.profile == 'all' else [args.profile]
    lock_path = Path(tempfile.gettempdir()) / f'bb-plugins-profile-restart-{os.getuid()}.lock'
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('another bb-restart is running')
        bundle = installed_bundle()
        failed = False
        for profile in selected:
            try:
                restart_profile(profile, bundle)
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
                print(f'{profile}: {error}', file=sys.stderr)
                failed = True
        return int(failed)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'bb-restart: {error}', file=sys.stderr)
        sys.exit(1)
