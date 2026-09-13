import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('restart', Path(__file__).with_name('restart.py'))
restart = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restart)


class RestartTest(unittest.TestCase):
    def test_old_launcher_cannot_count_as_ready(self):
        with patch.object(restart, 'service_pid', return_value=123), patch.object(restart.urllib.request, 'urlopen') as http:
            self.assertFalse(restart.ready('personal', 'target', 123, '1'))
            http.assert_not_called()

    def test_new_launcher_must_serve_installed_version(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"currentVersion":"1"}'
        with patch.object(restart, 'service_pid', return_value=456), patch.object(restart.urllib.request, 'urlopen', return_value=response):
            self.assertTrue(restart.ready('personal', 'target', 123, '1'))
            self.assertFalse(restart.ready('personal', 'target', 123, '2'))

    def run_restart(self, readiness, bundles=None, clock=None):
        bundle = ('1', [])
        with patch.object(restart, 'service_target', return_value='target'), \
             patch.object(restart, 'service_pid', return_value=123), \
             patch.object(restart, 'installed_bundle', side_effect=bundles, return_value=bundle), \
             patch.object(restart, 'launchctl') as ctl, \
             patch.object(restart, 'ready', side_effect=readiness), \
             patch.object(restart.time, 'sleep') as sleep, \
             patch.object(restart.time, 'monotonic', side_effect=clock, return_value=0):
            restart.restart_profile('personal', bundle)
            self.assertEqual(ctl.call_args.args, ('kill', 'SIGTERM', 'target'))
            return sleep.call_count

    def test_success_has_no_fixed_delay(self):
        self.assertEqual(self.run_restart([True]), 0)

    def test_temporary_connection_failure_waits_then_recovers(self):
        self.assertEqual(self.run_restart([OSError('down'), False, True]), 2)

    def test_update_during_restart_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'changed during restart'):
            self.run_restart([True], bundles=[('1', []), ('2', [])])

    def test_unready_service_times_out(self):
        with self.assertRaisesRegex(RuntimeError, 'not ready after 60s'):
            self.run_restart([False], clock=[0, 0, 61])

    def test_stopped_service_is_not_signalled(self):
        with patch.object(restart, 'service_target', return_value='target'), \
             patch.object(restart, 'service_pid', return_value=None), \
             patch.object(restart, 'launchctl') as ctl:
            with self.assertRaisesRegex(RuntimeError, 'not running'):
                restart.restart_profile('work', ('1', []))
            ctl.assert_not_called()


if __name__ == '__main__':
    unittest.main()
