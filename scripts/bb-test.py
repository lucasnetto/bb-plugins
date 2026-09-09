#!/usr/bin/env python3
"""Prepare disposable plugin tests using bb-app's own start/stop lifecycle."""

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


APP = Path("/Applications/bb.app/Contents")
PACKAGE = APP / "Resources/app.asar.unpacked/node_modules/bb-app"
MARKER = "bb-plugins-test-instance-v2"


def runtime_commands(package=None):
    package = Path(package).resolve() if package else PACKAGE
    manifest = read_json(package / "package.json")
    if manifest.get("name") != "bb-app":
        raise ValueError("--runtime must name a built bb-app package directory")
    executable = str(APP / "MacOS/bb") if package == PACKAGE else shutil.which("node")
    if not executable:
        raise FileNotFoundError("Node.js is required for a custom bb runtime")
    launcher = [executable, str(package / "dist/bb-app.js")]
    cli = [executable, str(package / "dist/bb.js")]
    for path in [*launcher, *cli, package / "app/dist/index.html"]:
        if not Path(path).is_file():
            raise FileNotFoundError(f"Incomplete bb runtime: {path}")
    return {"package": str(package), "launcher": launcher, "cli": cli}


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, value):
    temporary = path.with_suffix(".new")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def load_instance(directory):
    root = Path(directory).resolve()
    state = read_json(root / "instance.json")
    if (
        state.get("kind") != MARKER
        or state.get("directory") != str(root)
        or not root.name.startswith("bb-plugins-test-")
        or root.parent != Path(tempfile.gettempdir()).resolve()
    ):
        raise ValueError("Not a temporary instance created by this script")
    return root, state


def environment(root, state):
    # An agent's BB_*, provider routing, and credentials must not leak into
    # the test server or into CLI commands targeting it. Keep the real HOME.
    allowed = ("HOME", "USER", "LOGNAME", "PATH", "SHELL", "LANG", "LC_ALL", "TMPDIR")
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    env.update({
        "BB_DATA_DIR": str(root / "data"),
        "BB_SERVER_URL": state["url"],
        "BB_SERVER_PORT": str(state["serverPort"]),
        "BB_HOST_DAEMON_PORT": str(state["daemonPort"]),
        "BB_APP_SURFACE": "web",
        "ELECTRON_RUN_AS_NODE": "1",
        "npm_config_cache": str(root / "npm-cache"),
    })
    return env


def free_ports():
    # Hold both sockets until both allocations have completed. The bb launcher
    # verifies ownership at startup if another process wins the bind race.
    with socket.socket() as server, socket.socket() as daemon:
        server.bind(("127.0.0.1", 0))
        daemon.bind(("127.0.0.1", 0))
        return server.getsockname()[1], daemon.getsockname()[1]


def fetch_json(url):
    # Local instance probes must not inherit an HTTP proxy from the caller.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=1) as response:
        return json.load(response)


def is_ready(root, state):
    try:
        runtime = read_json(root / "data/bb-app-runtime.json")
        host = read_json(root / "data/auth.json")
        daemon = fetch_json(f"http://127.0.0.1:{state['daemonPort']}/status")
        return (
            runtime["pid"] == state["launcherPid"]
            and runtime["serverUrl"] == state["url"]
            and daemon["hostId"] == host["hostId"]
            and daemon["serverUrl"] == state["url"]
            and daemon["connected"]
            and fetch_json(state["url"] + "/health")["ok"]
        )
    except (OSError, ValueError, KeyError):
        return False


def run_cli(root, state, arguments, log=None):
    if not is_ready(root, state):
        raise RuntimeError("The recorded test server and daemon are not ready")
    return subprocess.run(
        [*state["runtime"]["cli"], *arguments], cwd=root, env=environment(root, state),
        stdout=log, stderr=log, check=True,
    )


def stop(directory, keep=False):
    root, state = load_instance(directory)
    runtime_path = root / "data/bb-app-runtime.json"
    runtime_record = runtime_path.read_bytes() if runtime_path.exists() else None
    subprocess.run(
        [*state["runtime"]["launcher"], "stop", "--data-dir", str(root / "data")],
        cwd=root, env=environment(root, state), check=True, timeout=30,
        stdout=sys.stderr,
    )
    for port in (state["serverPort"], state["daemonPort"]):
        with socket.socket() as probe:
            probe.settimeout(1)
            listening = probe.connect_ex(("127.0.0.1", port)) == 0
        if listening:
            if runtime_record is not None and not runtime_path.exists():
                runtime_path.write_bytes(runtime_record)
            raise RuntimeError(
                "A test port is still listening; retry stop outside the shell sandbox. "
                f"Diagnostics retained: {root}"
            )
    if runtime_path.exists():
        raise RuntimeError(f"bb did not release the test instance; diagnostics: {root}")
    if not keep:
        shutil.rmtree(root)


def start(args):
    plugins = [Path(path).resolve() for path in args.plugin]
    for plugin in plugins:
        manifest = read_json(plugin / "package.json")
        if "bb" not in manifest:
            raise ValueError(f"Not a bb plugin: {plugin}")
        if manifest["name"] == "bb-plugin-profiles":
            raise ValueError("Profiles is tied to the live Personal/Work URLs; it needs a dedicated fixture")
    runtime = runtime_commands(args.runtime)
    root = Path(tempfile.mkdtemp(prefix="bb-plugins-test-")).resolve()
    server_port, daemon_port = free_ports()
    state = {
        "kind": MARKER,
        "directory": str(root),
        "url": f"http://127.0.0.1:{server_port}",
        "serverPort": server_port,
        "daemonPort": daemon_port,
        "runtime": runtime,
        "plugins": [str(plugin) for plugin in plugins],
    }
    write_json(root / "instance.json", state)
    print(f"Starting test bb; logs: {root / 'launcher.log'}", file=sys.stderr)
    with (root / "launcher.log").open("w") as log:
        launcher = subprocess.Popen(
            [*runtime["launcher"], "start", "--data-dir", str(root / "data"),
             "--server-bind-host", "127.0.0.1",
             "--server-port", str(server_port), "--host-daemon-port", str(daemon_port)],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            start_new_session=True, cwd=root, env=environment(root, state),
        )
    state["launcherPid"] = launcher.pid
    write_json(root / "instance.json", state)
    try:
        deadline = time.monotonic() + 90
        while True:
            if launcher.poll() is not None:
                raise RuntimeError("Test bb exited during startup")
            if is_ready(root, state):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("Timed out starting test bb")
            time.sleep(0.3)
        with (root / "setup.log").open("w") as log:
            for plugin in plugins:
                print(f"Building and installing {plugin.name} into test bb", file=sys.stderr)
                run_cli(root, state, ["plugin", "build", str(plugin)], log)
                run_cli(root, state, ["plugin", "install", f"path:{plugin}", "--yes", "--json"], log)
        print(json.dumps(state, indent=2))
    except BaseException:
        print(f"Startup failed; keeping diagnostics in {root}", file=sys.stderr)
        try:
            stop(str(root), keep=True)
        finally:
            if launcher.poll() is None:
                launcher.terminate()
                launcher.wait(timeout=30)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    start_parser = commands.add_parser("start", help="Start a temporary instance; print its JSON descriptor")
    start_parser.add_argument("--plugin", action="append", default=[], metavar="DIRECTORY")
    start_parser.add_argument("--runtime", metavar="PACKAGE", help="Built bb-app package; defaults to installed bb.app")
    for command in ("stop", "status", "bb"):
        sub = commands.add_parser(command)
        sub.add_argument("directory")
        if command == "stop":
            sub.add_argument("--keep", action="store_true", help="Keep data and logs after stopping")
        if command == "bb":
            sub.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command == "start":
        start(args)
    elif args.command == "stop":
        stop(args.directory, args.keep)
    else:
        root, state = load_instance(args.directory)
        if args.command == "status":
            print(json.dumps({**state, "ready": is_ready(root, state)}, indent=2))
        else:
            arguments = args.arguments
            if arguments[:1] == ["--"]:
                arguments = arguments[1:]
            if not arguments:
                parser.error("bb requires a command")
            run_cli(root, state, arguments)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"bb-test: {error}", file=sys.stderr)
        sys.exit(1)
