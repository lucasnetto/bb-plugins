import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import refresh


class RefreshTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.installed = {p: [] for p in refresh.PROFILES}
        self.calls = []

    def package(self, relative='orbisa/plugins/bb', plugin_id='orbisa'):
        source = self.root / relative
        source.mkdir(parents=True)
        (source / 'package.json').write_text(json.dumps({'name': 'bb-plugin-' + plugin_id}))
        return source

    def plugin(self, source, plugin_id='orbisa', enabled=True, kind='path', version='1'):
        return dict(id=plugin_id, source=kind + ':' + str(source), rootDir=str(source),
                    version=version, enabled=enabled, status='running' if enabled else 'disabled')

    def both(self, plugin):
        for profile in refresh.PROFILES:
            self.installed[profile].append(copy.deepcopy(plugin))

    def run_cli(self, args, profile=None):
        self.calls.append((profile, args))
        if args[0] == 'list':
            return json.dumps({'plugins': self.installed[profile]})
        if args[0] == 'install':
            source = Path(args[1].removeprefix('path:'))
            plugin_id = json.loads((source / 'package.json').read_text())['name'].removeprefix('bb-plugin-')
            existing = next((p for p in self.installed[profile] if p['id'] == plugin_id), None)
            if existing is None:
                self.installed[profile].append(self.plugin(source, plugin_id))
            else:
                existing.update(self.plugin(source, plugin_id))
        if args[0] == 'disable':
            next(p for p in self.installed[profile] if p['id'] == args[1]).update(enabled=False, status='disabled')
        return ''

    def mutations(self):
        return [(profile, args) for profile, args in self.calls if args[0] != 'list']

    def test_discovers_other_repositories_builds_once_and_preserves_disabled(self):
        source = self.package()
        self.both(self.plugin(source))
        self.installed['work'][0].update(enabled=False, status='disabled')
        result = refresh.refresh([], run=self.run_cli)
        self.assertEqual(result['errors'], [])
        self.assertEqual(self.mutations(), [(None, ['build', str(source.resolve())]), ('personal', ['reload', 'orbisa'])])
        self.assertEqual({p['profile'] for p in result['plugins']}, {'personal', 'work'})
        self.assertEqual(len({p['build'] for p in result['plugins']}), 1)
        self.assertFalse(self.installed['work'][0]['enabled'])

    def test_same_id_different_sources_builds_each_without_reinstalling(self):
        for profile in refresh.PROFILES:
            self.installed[profile].append(self.plugin(self.package(profile)))
        before = copy.deepcopy(self.installed)
        result = refresh.refresh(['orbisa'], run=self.run_cli)
        self.assertEqual(result['errors'], [])
        self.assertEqual(sum(args[0] == 'build' for _, args in self.calls), 2)
        self.assertEqual(self.installed, before)
        self.assertFalse(any(args[0] == 'install' for _, args in self.calls))

    def test_symlink_sources_share_build_and_preserve_registered_paths(self):
        source = self.package()
        alias = self.root / 'alias'
        alias.symlink_to(source, target_is_directory=True)
        self.installed['personal'].append(self.plugin(source))
        self.installed['work'].append(self.plugin(alias))
        result = refresh.refresh([], run=self.run_cli)
        self.assertEqual(result['errors'], [])
        self.assertEqual(sum(args[0] == 'build' for _, args in self.calls), 1)
        self.assertEqual(result['plugins'][1]['installationPath'], str(alias))

    def test_uses_selected_package_root_for_collection_sources(self):
        source = self.package()
        plugin = self.plugin(source)
        plugin['source'] = 'path:' + str(source.parents[1])
        self.both(plugin)
        result = refresh.refresh([], run=self.run_cli)
        self.assertEqual(result['errors'], [])
        self.assertIn((None, ['build', str(source.resolve())]), self.calls)
        self.assertEqual(result['plugins'][0]['source'], plugin['source'])

    def test_managed_plugins_reload_without_building_updating_or_changing_versions(self):
        for kind in ('git', 'npm', 'builtin'):
            self.both(self.plugin(self.root / kind, plugin_id=kind, kind=kind))
        self.installed['work'][0]['version'] = '2'
        before = copy.deepcopy(self.installed)
        result = refresh.refresh([], run=self.run_cli)
        self.assertEqual(result['errors'], [])
        self.assertEqual(len(self.mutations()), 6)
        self.assertTrue(all(args[0] == 'reload' for _, args in self.mutations()))
        self.assertEqual(self.installed, before)

    def test_explicit_ids_filter_and_default_leaves_profile_only_plugins_alone(self):
        self.both(self.plugin(self.package()))
        self.installed['personal'].append(self.plugin(self.package('other', 'other'), plugin_id='other'))
        result = refresh.refresh(['orbisa'], run=self.run_cli)
        self.assertEqual(result['errors'], [])
        self.assertEqual(len(result['plugins']), 2)
        self.calls.clear()
        result = refresh.refresh([], run=self.run_cli)
        self.assertEqual(result['errors'], [])
        self.assertEqual(len(result['plugins']), 3)
        self.assertFalse(any(args[0] == 'install' for _, args in self.calls))

    def test_check_is_read_only_and_reports_unhealthy_plugins(self):
        self.both(self.plugin(self.package()))
        self.installed['work'][0]['status'] = 'error'
        result = refresh.refresh([], check=True, run=self.run_cli)
        self.assertEqual(self.mutations(), [])
        self.assertTrue(result['plugins'][0]['healthy'])
        self.assertFalse(result['plugins'][1]['healthy'])
        self.assertEqual(len(result['errors']), 1)

    def test_failed_shared_build_runs_once_and_never_reloads(self):
        self.both(self.plugin(self.package()))
        def run(args, profile=None):
            result = self.run_cli(args, profile)
            if args[0] == 'build':
                raise RuntimeError('build failed')
            return result
        result = refresh.refresh([], run=run)
        self.assertEqual(len(result['errors']), 2)
        self.assertEqual(len(self.mutations()), 1)
        self.assertTrue(all(not p['healthy'] for p in result['plugins']))

    def test_unreachable_profile_does_not_prevent_refreshing_available_profile(self):
        self.both(self.plugin(self.package()))
        def run(args, profile=None):
            if profile == 'work':
                raise RuntimeError('unreachable')
            return self.run_cli(args, profile)
        result = refresh.refresh([], run=run)
        self.assertEqual(len(result['errors']), 1)
        self.assertTrue(result['plugins'][0]['healthy'])

    def test_failed_reload_does_not_claim_success(self):
        self.both(self.plugin(self.package()))
        def run(args, profile=None):
            result = self.run_cli(args, profile)
            if args[0] == 'reload' and profile == 'personal':
                raise RuntimeError('reload failed')
            return result
        result = refresh.refresh([], run=run)
        self.assertEqual(len(result['errors']), 1)
        self.assertFalse(result['plugins'][0]['healthy'])
        self.assertTrue(result['plugins'][1]['healthy'])

    def test_missing_local_source_is_reported_without_repairing_or_reloading(self):
        self.both(self.plugin(self.root / 'missing'))
        result = refresh.refresh([], run=self.run_cli)
        self.assertEqual(len(result['errors']), 2)
        self.assertEqual(self.mutations(), [])

    def test_worktree_sources_are_rejected_but_main_checkout_is_supported(self):
        source = self.package()
        root = source.parents[1]
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
        subprocess.run(['git', '-C', str(root), '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
                        'commit', '-q', '-m', 'init'], check=True)
        task = self.root / 'task'
        subprocess.run(['git', '-C', str(root), 'worktree', 'add', '-q', '-b', 'task', str(task)], check=True)
        self.installed['personal'].append(self.plugin(source))
        self.installed['work'].append(self.plugin(task / 'plugins/bb'))
        result = refresh.refresh([], run=self.run_cli)
        self.assertEqual(len(result['errors']), 1)
        self.assertIn('task worktree', result['errors'][0])
        self.assertTrue(result['plugins'][0]['healthy'])
        self.assertEqual(len(self.mutations()), 2)

    def test_installation_changed_during_build_is_not_reloaded(self):
        self.both(self.plugin(self.package()))
        def run(args, profile=None):
            result = self.run_cli(args, profile)
            if args[0] == 'build':
                self.installed['personal'][0]['enabled'] = False
            return result
        result = refresh.refresh([], run=run)
        self.assertEqual(len(result['errors']), 1)
        self.assertNotIn(('personal', ['reload', 'orbisa']), self.calls)

    def test_profiles_itself_reloads_last(self):
        self.both(self.plugin(self.package('profiles', 'profiles'), plugin_id='profiles'))
        self.both(self.plugin(self.package('zzz', 'zzz'), plugin_id='zzz'))
        result = refresh.refresh([], run=self.run_cli)
        self.assertEqual(result['errors'], [])
        for profile in refresh.PROFILES:
            self.assertEqual([args[1] for p, args in self.calls if p == profile and args[0] == 'reload'], ['zzz', 'profiles'])

    def test_install_missing_copies_existing_local_source_and_disabled_state(self):
        source = self.package()
        self.installed['personal'].append(self.plugin(source, enabled=False))
        result = refresh.refresh(['orbisa'], run=self.run_cli, install_missing=True)
        self.assertEqual(result['errors'], [])
        self.assertEqual(sum(args[0] == 'build' for _, args in self.calls), 1)
        self.assertIn(('work', ['install', 'path:' + str(source.resolve()), '--yes']), self.calls)
        self.assertFalse(self.installed['work'][0]['enabled'])
        self.assertTrue(all(p['healthy'] for p in result['plugins']))

    def test_missing_plugins_require_explicit_install_missing(self):
        self.installed['personal'].append(self.plugin(self.package()))
        result = refresh.refresh(['orbisa'], run=self.run_cli)
        self.assertEqual(len(result['errors']), 1)
        self.assertEqual(self.installed['work'], [])

    def test_install_missing_does_not_guess_unregistered_sources(self):
        self.package()
        result = refresh.refresh(['orbisa'], run=self.run_cli, install_missing=True)
        self.assertEqual(len(result['errors']), 2)
        self.assertEqual(self.mutations(), [])

    def test_install_missing_does_not_resolve_managed_ranges(self):
        self.installed['personal'].append(self.plugin(self.root / 'managed', kind='git'))
        result = refresh.refresh(['orbisa'], run=self.run_cli, install_missing=True)
        self.assertEqual(len(result['errors']), 1)
        self.assertEqual(self.installed['work'], [])
        self.assertTrue(all(args[0] == 'reload' for _, args in self.mutations()))

    def test_install_missing_requires_explicit_ids_and_mutating_mode(self):
        for ids, check in [([], False), (['orbisa'], True)]:
            with self.assertRaises(RuntimeError):
                refresh.refresh(ids, check=check, run=self.run_cli, install_missing=True)
        self.assertEqual(self.calls, [])

    def test_source_override_moves_both_profiles_without_removing_state(self):
        self.both(self.plugin(self.root / 'deleted-old-checkout'))
        self.installed['work'][0].update(enabled=False, status='disabled', settings={'region': 'test'})
        destination = self.package()
        result = refresh.refresh(['orbisa'], run=self.run_cli, source_override=str(destination))
        self.assertEqual(result['errors'], [])
        self.assertEqual(sum(args[0] == 'build' for _, args in self.calls), 1)
        self.assertEqual(sum(args[0] == 'install' for _, args in self.calls), 2)
        self.assertFalse(any(args[0] == 'remove' for _, args in self.calls))
        self.assertTrue(all(p['healthy'] and p['installationPath'] == str(destination.resolve()) for p in result['plugins']))
        self.assertEqual(self.installed['work'][0]['settings'], {'region': 'test'})
        self.assertFalse(self.installed['work'][0]['enabled'])

    def test_source_override_requires_matching_package_before_any_mutation(self):
        destination = self.package(plugin_id='different')
        with self.assertRaisesRegex(RuntimeError, 'identity'):
            refresh.refresh(['orbisa'], run=self.run_cli, source_override=destination)
        self.assertEqual(self.calls, [])

    def test_source_override_does_not_replace_managed_installations(self):
        self.both(self.plugin(self.root / 'managed', kind='git'))
        result = refresh.refresh(['orbisa'], run=self.run_cli, source_override=self.package())
        self.assertEqual(len(result['errors']), 2)
        self.assertEqual(self.mutations(), [])

    def test_source_override_does_not_install_absent_plugins(self):
        result = refresh.refresh(['orbisa'], run=self.run_cli, source_override=self.package())
        self.assertEqual(len(result['errors']), 2)
        self.assertEqual(self.mutations(), [])

    def test_source_override_failed_build_keeps_old_source(self):
        self.both(self.plugin(self.root / 'old'))
        original = copy.deepcopy(self.installed)
        def run(args, profile=None):
            result = self.run_cli(args, profile)
            if args[0] == 'build':
                raise RuntimeError('failed')
            return result
        result = refresh.refresh(['orbisa'], run=run, source_override=self.package())
        self.assertEqual(len(result['errors']), 2)
        self.assertEqual(self.installed, original)
        self.assertEqual(len(self.mutations()), 1)

    def test_source_override_requires_one_id_and_mutating_mode(self):
        for ids, check, install in [([], False, False), (['a', 'b'], False, False),
                                    (['orbisa'], True, False), (['orbisa'], False, True)]:
            with self.assertRaises(RuntimeError):
                refresh.refresh(ids, check=check, install_missing=install, run=self.run_cli, source_override='/unused')
        self.assertEqual(self.calls, [])

class MachineRefreshTest(unittest.TestCase):
    setUp = RefreshTest.setUp
    plugin = RefreshTest.plugin
    both = RefreshTest.both
    run_cli = RefreshTest.run_cli
    mutations = RefreshTest.mutations
    def remote(self, hosts=None, offline=None):
        owner = self
        class Runner:
            def __init__(self):
                self.hosts = hosts or {'personal': 'linux', 'work': 'mac'}
                self.inspections = []
            def inspect_source(self, path, profile):
                self.inspections.append((profile, path))
                return {'path': path, 'name': 'bb-plugin-orbisa', 'hash': profile + '-hash'}
            def __call__(self, args, profile=None):
                if profile == offline:
                    raise RuntimeError('offline')
                return owner.run_cli(args, profile)
        return Runner()

    def test_same_path_on_different_hosts_builds_twice_on_owning_hosts(self):
        self.both(self.plugin('/permanent/plugin'))
        runner = self.remote()
        result = refresh.refresh(['orbisa'], run=runner)
        self.assertEqual(result['errors'], [])
        self.assertEqual([(p, a) for p, a in self.calls if a[0] == 'build'],
                         [('personal', ['build', '/permanent/plugin']), ('work', ['build', '/permanent/plugin'])])
        self.assertEqual([p['build'] for p in result['plugins']], ['personal-hash', 'work-hash'])

    def test_check_inspects_remote_sources_without_local_files_or_mutations(self):
        self.both(self.plugin('/not/on/this/machine'))
        runner = self.remote()
        result = refresh.refresh(['orbisa'], check=True, run=runner)
        self.assertEqual(result['errors'], [])
        self.assertEqual(self.mutations(), [])
        self.assertEqual({p for p, _ in runner.inspections}, {'personal', 'work'})

    def test_same_machine_can_share_build(self):
        self.both(self.plugin('/permanent/plugin'))
        result = refresh.refresh(['orbisa'], run=self.remote({'personal': 'mac', 'work': 'mac'}))
        self.assertEqual(result['errors'], [])
        self.assertEqual(sum(a[0] == 'build' for _, a in self.calls), 1)

    def test_cross_machine_source_copy_fails_before_any_operation(self):
        for kwargs in [{'source_override': '/permanent/plugin'}, {'install_missing': True}]:
            with self.assertRaisesRegex(RuntimeError, 'same machine'):
                refresh.refresh(['orbisa'], run=self.remote(), **kwargs)
        self.assertEqual(self.calls, [])

    def test_offline_machine_leaves_other_machine_refresh_available(self):
        self.both(self.plugin('/permanent/plugin'))
        result = refresh.refresh(['orbisa'], run=self.remote(offline='work'))
        self.assertEqual(len(result['errors']), 1)
        self.assertTrue(result['plugins'][0]['healthy'])

    def test_coordinating_profile_runs_after_remote_profile(self):
        self.both(self.plugin('/permanent/plugin'))
        runner = self.remote()
        runner.current_profile = 'personal'
        result = refresh.refresh(['orbisa'], run=runner)
        self.assertEqual(result['errors'], [])
        self.assertEqual([p for p, a in self.calls if a[0] == 'reload'], ['work', 'personal'])


if __name__ == '__main__':
    unittest.main()
