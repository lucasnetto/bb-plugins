import unittest
import tempfile
import subprocess
from pathlib import Path
from unittest.mock import patch
from configuration import profile_urls, permanent_source, desktop_contents


class ConfigurationTest(unittest.TestCase):
    def test_only_distinct_loopback_administration_is_allowed(self):
        values = {'personalLocalUrl': 'http://127.0.0.1:3001', 'workLocalUrl': 'http://localhost:3002/'}
        self.assertEqual(profile_urls(values)['work'], 'http://localhost:3002')
        for invalid in ('https://remote.example.com', 'http://user:password@localhost:3002', 'http://localhost:3002/path', values['personalLocalUrl']):
            with self.assertRaises(RuntimeError):
                profile_urls({**values, 'workLocalUrl': invalid})

    def test_main_checkout_is_discovered_and_task_worktrees_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'main'
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'init'], check=True)
            self.assertEqual(permanent_source(root), root.resolve())
            task = Path(directory) / 'task'
            subprocess.run(['git', '-C', str(root), 'worktree', 'add', '-q', '-b', 'task', str(task)], check=True)
            with self.assertRaisesRegex(RuntimeError, 'main repository checkout'):
                permanent_source(task)

    def test_desktop_location_follows_official_cli(self):
        with patch.dict('os.environ', {'BB_CLI': '/custom/bb.app/Contents/Resources/cli/bb'}):
            self.assertEqual(desktop_contents(), Path('/custom/bb.app/Contents'))
