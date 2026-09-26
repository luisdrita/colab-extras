import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'src/delete_folder.py'
spec = importlib.util.spec_from_file_location('delete_folder', SCRIPT)
delete = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delete)


class DeleteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "results ' café $(touch nope)"
        self.source.mkdir()
        (self.source / 'nested').mkdir()
        (self.source / 'nested/data.txt').write_text('disposable fixture')
        self.reports = []

    def tearDown(self):
        self.temp.cleanup()

    def remove(self, path=None):
        delete.remove_folder(str(path or self.source), root=self.root,
                             report=lambda **data: self.reports.append(data))

    def test_removes_nested_empty_and_hidden_contents_but_preserves_siblings(self):
        (self.source / 'empty').mkdir()
        (self.source / '.hidden').write_text('hidden')
        sibling = self.root / 'keep.txt'
        sibling.write_text('keep')
        archive = self.source.with_name(self.source.name + '.zip')
        archive.write_bytes(b'keep archive')
        previous = Path.cwd()
        self.remove()
        self.assertFalse(self.source.exists())
        self.assertEqual(sibling.read_text(), 'keep')
        self.assertEqual(archive.read_bytes(), b'keep archive')
        self.assertEqual(Path.cwd(), previous)
        self.assertEqual(self.reports[-1], {'state': 'deleted', 'path': str(self.source)})
        self.assertFalse((self.root / 'nope').exists())

    def test_links_inside_folder_are_unlinked_without_touching_targets(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'keep.txt').write_text('keep')
        (self.source / 'linked-folder').symlink_to(outside, target_is_directory=True)
        (self.source / 'linked-file').symlink_to(outside / 'keep.txt')
        (self.source / 'broken').symlink_to('missing')
        self.remove()
        self.assertEqual((outside / 'keep.txt').read_text(), 'keep')

    def test_selected_symlink_is_rejected(self):
        link = self.root / 'link'
        link.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.remove(link)
        self.assertTrue((self.source / 'nested/data.txt').exists())

    def test_parent_symlink_is_rejected(self):
        link = self.root / 'link'
        link.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(OSError):
            self.remove(link / 'nested')
        self.assertTrue((self.source / 'nested/data.txt').exists())

    def test_runtime_drive_and_job_roots_are_protected(self):
        for path in ['/', '/content', '/tmp/results', '/content/../etc', '/content/./results',
                     '/content/drive', '/content/drive/MyDrive', '/content/drive/Shareddrives',
                     '/content/drive/Shareddrives/Team', '/content/.colab-folder-zip-job/sub',
                     '/content/name\nwith-newline']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                delete.validate_path(path)

    def test_normal_drive_subfolders_are_allowed(self):
        for path in ['/content/drive/MyDrive/results', '/content/drive/Shareddrives/Team/results']:
            self.assertEqual(str(delete.validate_path(path)[0]), path)

    def test_file_and_missing_folder_report_errors(self):
        for path in [self.source / 'nested/data.txt', self.root / 'missing']:
            with self.subTest(path=path), self.assertRaises((ValueError, FileNotFoundError)):
                self.remove(path)
            self.assertFalse(self.reports[-1]['partial'])
        self.assertTrue(self.source.exists())

    def test_no_unsafe_rmtree_fallback(self):
        with patch.object(delete.shutil.rmtree, 'avoids_symlink_attacks', False):
            with self.assertRaises(RuntimeError):
                self.remove()
        self.assertTrue((self.source / 'nested/data.txt').exists())

    def test_nested_mount_rejected_before_any_deletion(self):
        with patch.object(delete.os.path, 'ismount', side_effect=lambda p: str(p).endswith('/nested')):
            with self.assertRaises(ValueError):
                self.remove()
        self.assertTrue((self.source / 'nested/data.txt').exists())
        self.assertFalse(self.reports[-1]['partial'])

    def test_replaced_top_folder_fails_without_deleting_replacement(self):
        original = self.root / 'moved-original'
        def report(**data):
            self.reports.append(data)
            if data['state'] == 'checking':
                self.source.rename(original)
                self.source.mkdir()
                (self.source / 'keep.txt').write_text('replacement')
        with self.assertRaises(RuntimeError):
            delete.remove_folder(str(self.source), root=self.root, report=report)
        self.assertEqual((self.source / 'keep.txt').read_text(), 'replacement')
        self.assertTrue((original / 'nested/data.txt').exists())

    def test_partial_failure_is_reported_and_other_data_is_preserved(self):
        real_rmtree = delete.shutil.rmtree
        def interrupted(path):
            (Path(path) / 'nested/data.txt').unlink()
            raise PermissionError('Example permission failure')
        interrupted.avoids_symlink_attacks = real_rmtree.avoids_symlink_attacks
        with patch.object(delete.shutil, 'rmtree', interrupted), self.assertRaises(PermissionError):
            self.remove()
        self.assertEqual(self.reports[-1]['state'], 'error')
        self.assertTrue(self.reports[-1]['partial'])
        self.assertTrue(self.source.exists())

    def test_cli_rejects_protected_path_and_writes_machine_readable_error(self):
        job = self.root / 'job'
        job.mkdir()
        result = subprocess.run([sys.executable, str(SCRIPT), '/content', str(job)], capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        status = json.loads((job / 'status.json').read_text())
        self.assertEqual(status['state'], 'error')
        self.assertFalse(status['partial'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
