import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('refresh', Path(__file__).with_name('refresh.py'))
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


class RefreshTest(unittest.TestCase):
    def test_build_once_preserve_disabled_repair_source_and_report_both(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'plugins/example'
            source.mkdir(parents=True)
            (source / 'package.json').write_text('{"name":"bb-plugin-example"}')
            calls = []
            installed = {p: dict(id='example', source='path:/old/task', rootDir='/old/task', version='1', enabled=p == 'personal', status='running' if p == 'personal' else 'disabled') for p in refresh.PROFILES}
            def run(args, profile=None):
                calls.append((profile, args))
                if args[0] == 'list': return json.dumps({'plugins': [installed[profile]]})
                if args[0] == 'install': installed[profile].update(source=args[1], rootDir=str(source), enabled=True, status='running')
                if args[0] == 'disable': installed[profile].update(enabled=False, status='disabled')
                return ''
            result = refresh.refresh(root, ['example'], run=run)
            self.assertEqual(result['errors'], [])
            self.assertEqual(len([c for c in calls if c[1][0] == 'build']), 1)
            self.assertFalse(installed['work']['enabled'])
            self.assertEqual({p['profile'] for p in result['plugins']}, {'personal', 'work'})
            self.assertEqual(len({p['build'] for p in result['plugins']}), 1)
            calls.clear()
            refresh.refresh(root, ['example'], check=True, run=run)
            self.assertTrue(all(c[1][0] == 'list' for c in calls))

    def test_unreachable_profile_and_failed_build_do_not_claim_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'plugins/example'
            source.mkdir(parents=True)
            (source / 'package.json').write_text('{"name":"bb-plugin-example"}')
            calls = []
            def run(args, profile=None):
                calls.append(args)
                if profile == 'work' or args[0] == 'build': raise RuntimeError('failed')
                return json.dumps({'plugins': [dict(id='example', source='path:'+str(source), enabled=True)]})
            result = refresh.refresh(root, ['example'], run=run)
            self.assertEqual(len(result['errors']), 2)
            self.assertFalse(any(c[0] in ('reload', 'install') for c in calls))

if __name__ == '__main__': unittest.main()
