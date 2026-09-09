import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "bb_test", Path(__file__).resolve().parents[1] / "bb-test.py"
)
bb_test = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bb_test)


class TestInstanceIsolation(unittest.TestCase):
    def test_cli_environment_cannot_inherit_live_routing_or_credentials(self):
        inherited = {
            "HOME": "/Users/example",
            "PATH": "/usr/bin:/bin",
            "BB_SERVER_URL": "http://127.0.0.1:38886",
            "BB_CLI": "/wrong/bb",
            "BB_HOST_ID": "live-host",
            "BB_THREAD_ID": "live-thread",
            "BB_PROJECT_ID": "live-project",
            "BB_ENVIRONMENT_ID": "live-worktree",
            "CODEX_HOME": "/work/codex",
            "CODEX_OPENAI_BASE_URL": "https://live-provider.example",
            "CURSOR_API_KEY": "test-value",
            "NODE_OPTIONS": "--require=/unrelated-hook.js",
            "npm_config_cache": "/live/cache",
        }
        state = {"url": "http://127.0.0.1:55000", "serverPort": 55000, "daemonPort": 55001}
        with patch.dict(os.environ, inherited, clear=True):
            env = bb_test.environment(Path("/tmp/test"), state)
        self.assertEqual(env["HOME"], inherited["HOME"])
        self.assertEqual(env["BB_SERVER_URL"], state["url"])
        self.assertEqual(env["BB_DATA_DIR"], "/tmp/test/data")
        self.assertEqual(env["npm_config_cache"], "/tmp/test/npm-cache")
        for key in inherited.keys() - {"HOME", "PATH", "BB_SERVER_URL", "npm_config_cache"}:
            self.assertNotIn(key, env)

    def test_stop_rejects_a_directory_outside_the_owned_temp_namespace(self):
        with tempfile.TemporaryDirectory(prefix="unrelated-") as directory:
            root = Path(directory).resolve()
            bb_test.write_json(root / "instance.json", {
                "kind": bb_test.MARKER, "directory": str(root),
            })
            sentinel = root / "valuable-file"
            sentinel.write_text("keep")
            with self.assertRaises(ValueError):
                bb_test.stop(directory)
            self.assertEqual(sentinel.read_text(), "keep")
            self.assertFalse((root / "stop").exists())

    def test_copied_descriptor_cannot_stop_a_different_instance(self):
        with tempfile.TemporaryDirectory(prefix="bb-plugins-test-") as directory:
            root = Path(directory).resolve()
            bb_test.write_json(root / "instance.json", {
                "kind": bb_test.MARKER, "directory": "/different/bb-plugins-test-original",
            })
            with self.assertRaises(ValueError):
                bb_test.stop(directory)
            self.assertFalse((root / "stop").exists())

    def test_native_stop_refusal_preserves_test_data(self):
        with tempfile.TemporaryDirectory(prefix="bb-plugins-test-") as directory:
            root = Path(directory).resolve()
            bb_test.write_json(root / "instance.json", {
                "kind": bb_test.MARKER,
                "directory": str(root),
                "url": "http://127.0.0.1:55000",
                "serverPort": 55000,
                "daemonPort": 55001,
                "runtime": {"launcher": ["node", "/test/bb-app.js"]},
            })
            sentinel = root / "diagnostics.log"
            sentinel.write_text("keep for inspection")
            failure = subprocess.CalledProcessError(1, ["bb-app", "stop"])
            with patch.object(bb_test.subprocess, "run", side_effect=failure):
                with self.assertRaises(subprocess.CalledProcessError):
                    bb_test.stop(directory)
            self.assertEqual(sentinel.read_text(), "keep for inspection")

    def test_unreleased_runtime_requires_built_frontend(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bb_test.write_json(root / "package.json", {"name": "bb-app"})
            (root / "dist").mkdir()
            for name in ["bb-app.js", "bb.js"]:
                (root / "dist" / name).touch()
            with self.assertRaisesRegex(FileNotFoundError, "app/dist/index.html"):
                bb_test.runtime_commands(root)

    def test_native_stop_cannot_delete_data_while_a_test_port_is_listening(self):
        with tempfile.TemporaryDirectory(prefix="bb-plugins-test-") as directory:
            root = Path(directory).resolve()
            bb_test.write_json(root / "instance.json", {
                "kind": bb_test.MARKER,
                "directory": str(root),
                "url": "http://127.0.0.1:55000",
                "serverPort": 55000,
                "daemonPort": 55001,
                "runtime": {"launcher": ["node", "/test/bb-app.js"]},
            })
            runtime_path = root / "data/bb-app-runtime.json"
            runtime_path.parent.mkdir()
            runtime_record = '{"pid": 123, "startedAt": 456}\n'
            runtime_path.write_text(runtime_record)
            with patch.object(bb_test.subprocess, "run", side_effect=lambda *a, **k: runtime_path.unlink()):
                with patch.object(bb_test.socket, "socket") as connection:
                    connection.return_value.__enter__.return_value.connect_ex.return_value = 0
                    with self.assertRaisesRegex(RuntimeError, "test port is still listening"):
                        bb_test.stop(directory)
            self.assertEqual(runtime_path.read_text(), runtime_record)


if __name__ == "__main__":
    unittest.main()
