import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import mock_open, patch

SCRIPT = Path(__file__).resolve().parents[1] / 'src/delete_folder.py'
spec = importlib.util.spec_from_file_location('bulk_delete', SCRIPT)
delete = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delete)


class BulkDeleteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.folder = self.root / 'results'
        (self.folder / 'nested').mkdir(parents=True)
        (self.folder / 'nested/data.txt').write_text('selected')
        self.file = self.root / "data ' café $(touch nope).csv"
        self.file.write_text('selected file')
        self.keep = self.root / 'keep.txt'
        self.keep.write_text('unselected')
        self.reports = []

    def tearDown(self):
        self.temp.cleanup()

    def item(self, path, directory=False):
        return dict(path=str(path), isDirectory=directory)

    def remove(self, items):
        return delete.remove_selected(items, self.root, lambda **data: self.reports.append(data))

    def test_mixed_files_and_recursive_folders_preserve_unselected_sibling(self):
        before = Path.cwd()
        result = self.remove([self.item(self.folder, True), self.item(self.file)])
        self.assertEqual([item['deleted'] for item in result], [True, True])
        self.assertFalse(self.folder.exists())
        self.assertFalse(self.file.exists())
        self.assertEqual(self.keep.read_text(), 'unselected')
        self.assertFalse((self.root / 'nope').exists())
        self.assertEqual(Path.cwd(), before)
        self.assertEqual(self.reports[-1]['state'], 'complete')
        self.assertEqual(self.reports[-1]['completed'], 2)

    def test_overlay_zip_files_with_different_device_ids_are_deleted(self):
        # Colab's overlayfs reports the underlying device for ordinary files
        # and the overlay device for directories. ismount() falsely says True.
        archives = [self.root / 'sample_data.zip', self.root / 'sample_data (2).zip']
        for archive in archives:
            archive.write_bytes(b'disposable ZIP fixture')
        unselected = self.root / 'sample_data (1).zip'
        unselected.write_bytes(b'keep this ZIP')
        real_lstat = os.lstat
        def overlay_lstat(path, *args, **kwargs):
            result = real_lstat(path, *args, **kwargs)
            if Path(path).name in {archive.name for archive in archives}:
                fields = list(result)
                fields[2] += 1  # st_dev, as observed on hosted Colab
                return os.stat_result(fields)
            return result
        mounts = '31 1 0:47 / / rw,relatime - overlay overlay rw\n'
        with patch.object(delete.sys, 'platform', 'linux'), \
                patch.object(delete.os, 'lstat', side_effect=overlay_lstat), \
                patch('builtins.open', mock_open(read_data=mounts)):
            self.assertTrue(all(os.path.ismount(archive) for archive in archives))
            result = self.remove([self.item(archive) for archive in archives])
        self.assertEqual([item['deleted'] for item in result], [True, True], result)
        self.assertTrue(all(not archive.exists() for archive in archives))
        self.assertEqual(unselected.read_bytes(), b'keep this ZIP')
        self.assertTrue((self.folder / 'nested/data.txt').exists())
        self.assertEqual(self.keep.read_text(), 'unselected')

    def test_parent_and_children_are_deleted_once_regardless_of_order(self):
        result = self.remove([self.item(self.folder / 'nested/data.txt'),
                              self.item(self.folder, True), self.item(self.folder / 'nested', True),
                              self.item(self.folder, True)])
        self.assertEqual(result, [dict(path=str(self.folder), deleted=True)])

    def test_selected_children_preserve_parent_and_unselected_contents(self):
        first = self.folder / 'first.txt'
        second = self.folder / 'second.txt'
        keep = self.folder / 'keep.txt'
        for path in [first, second, keep]:
            path.write_text(path.name)
        result = self.remove([self.item(first), self.item(second)])
        self.assertTrue(all(item['deleted'] for item in result))
        self.assertFalse(first.exists())
        self.assertFalse(second.exists())
        self.assertEqual(keep.read_text(), 'keep.txt')
        self.assertEqual((self.folder / 'nested/data.txt').read_text(), 'selected')
        self.assertTrue(self.folder.is_dir())
        first.write_text('selected again')
        result = self.remove([self.item(self.folder / 'nested', True), self.item(first)])
        self.assertTrue(all(item['deleted'] for item in result))
        self.assertFalse((self.folder / 'nested').exists())
        self.assertFalse(first.exists())
        self.assertEqual(keep.read_text(), 'keep.txt')
        self.assertTrue(self.folder.is_dir())
        self.assertEqual(self.keep.read_text(), 'unselected')

    def test_sibling_with_similar_name_is_separate(self):
        other = self.root / 'results-extra'
        other.mkdir()
        self.assertEqual(len(delete.deletion_plan([self.item(self.folder, True), self.item(other, True)], self.root)), 2)

    def test_invalid_or_protected_entry_aborts_entire_plan_before_deletion(self):
        for invalid in [self.item(self.root, True), self.item(self.root / '../elsewhere'),
                        self.item(self.root / '.colab-folder-zip-job', True),
                        dict(path=str(self.file), isDirectory='false'), None]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.remove([self.item(self.file), invalid])
            self.assertTrue(self.file.exists())
        with self.assertRaises(ValueError):
            self.remove([])

    def test_missing_item_does_not_prevent_other_selected_deletions(self):
        missing = self.root / 'missing'
        result = self.remove([self.item(missing), self.item(self.file)])
        self.assertFalse(result[0]['deleted'])
        self.assertFalse(result[0]['partial'])
        self.assertTrue(result[1]['deleted'])
        self.assertTrue(self.folder.exists())

    def test_changed_type_is_not_deleted(self):
        result = self.remove([self.item(self.folder), self.item(self.file, True)])
        self.assertTrue(all(not item['deleted'] for item in result))
        self.assertTrue(self.file.exists())
        self.assertTrue(self.folder.exists())

    def test_selected_and_parent_symlinks_never_followed(self):
        link = self.root / 'link'
        link.symlink_to(self.folder, target_is_directory=True)
        linked_file = self.root / 'linked-file'
        linked_file.symlink_to(self.file)
        result = self.remove([self.item(link, True), self.item(link / 'nested', True), self.item(linked_file)])
        self.assertTrue(all(not item['deleted'] for item in result))
        self.assertTrue((self.folder / 'nested/data.txt').exists())
        self.assertTrue(self.file.exists())

    def test_file_replacement_during_check_is_preserved(self):
        old = self.root / 'old-file'
        def report(**data):
            if data['state'] == 'checking':
                self.file.rename(old)
                self.file.write_text('replacement')
        with self.assertRaises(RuntimeError):
            delete.remove_item(str(self.file), False, self.root, report)
        self.assertEqual(self.file.read_text(), 'replacement')
        self.assertEqual(old.read_text(), 'selected file')

    def test_permission_failure_keeps_file_and_continues_other_items(self):
        original = delete.os.unlink
        def unlink(path, *args, **kwargs):
            if str(path) == self.file.name:
                raise PermissionError('permission denied fixture')
            return original(path, *args, **kwargs)
        with patch.object(delete.os, 'unlink', unlink):
            result = self.remove([self.item(self.file), self.item(self.folder, True)])
        self.assertFalse(result[0]['deleted'])
        self.assertIn('permission denied', result[0]['error'])
        self.assertTrue(result[1]['deleted'])
        self.assertTrue(self.file.exists())
        self.assertTrue(self.keep.exists())

    def test_partial_folder_failure_is_reported_and_batch_continues(self):
        original = delete.shutil.rmtree
        def interrupted(path):
            (Path(path) / 'nested/data.txt').unlink()
            raise PermissionError('partial fixture')
        interrupted.avoids_symlink_attacks = original.avoids_symlink_attacks
        with patch.object(delete.shutil, 'rmtree', interrupted):
            result = self.remove([self.item(self.folder, True), self.item(self.file)])
        self.assertTrue(result[0]['partial'])
        self.assertFalse(result[0]['deleted'])
        self.assertTrue(result[1]['deleted'])
        self.assertTrue(self.folder.exists())

    def test_mounts_and_special_files_are_rejected(self):
        fifo = self.root / 'fifo'
        os.mkfifo(fifo)
        with patch.object(delete, 'runtime_mounts', return_value={self.file.resolve(), self.folder.resolve()}):
            result = self.remove([self.item(self.file), self.item(self.folder, True), self.item(fifo)])
        self.assertTrue(all(not item['deleted'] for item in result))
        self.assertTrue(self.file.exists())
        self.assertTrue(self.folder.exists())

    def test_linux_same_device_file_mount_is_preserved_and_batch_continues(self):
        # A bind mount may have the same device ID as its containing folder.
        self.assertEqual(self.file.stat().st_dev, self.root.stat().st_dev)
        point = str(self.file.resolve()).replace(' ', r'\040')
        table = '31 1 0:47 / / rw - overlay overlay rw\n'
        table += '32 31 0:47 /original ' + point + ' rw shared:1 - ext4 /dev/root rw\n'
        with patch.object(delete.sys, 'platform', 'linux'), \
                patch('builtins.open', mock_open(read_data=table)):
            result = self.remove([self.item(self.file), self.item(self.folder, True)])
        self.assertFalse(result[0]['deleted'])
        self.assertFalse(result[0]['partial'])
        self.assertIn('mounted file', result[0]['error'])
        self.assertTrue(result[1]['deleted'])
        self.assertTrue(self.file.exists())
        self.assertTrue(self.keep.exists())

    def test_nested_file_mount_prevents_any_folder_deletion(self):
        mounted_file = self.folder / 'nested/data.txt'
        with patch.object(delete, 'runtime_mounts', return_value={mounted_file.resolve()}):
            result = self.remove([self.item(self.folder, True)])
        self.assertFalse(result[0]['deleted'])
        self.assertFalse(result[0]['partial'])
        self.assertEqual(mounted_file.read_text(), 'selected')

    def test_mount_ancestor_and_similar_sibling_do_not_block_ordinary_items(self):
        # Deleting a normal folder inside a mounted filesystem is allowed;
        # deleting the mount itself or a folder that contains it is not.
        mounts = {self.root.resolve(), self.root.resolve() / 'results-extra'}
        with patch.object(delete, 'runtime_mounts', return_value=mounts):
            result = self.remove([self.item(self.folder, True), self.item(self.file)])
        self.assertTrue(all(item['deleted'] for item in result))
        self.assertTrue(self.keep.exists())

    def test_unreadable_linux_mount_table_preserves_all_targets(self):
        with patch.object(delete.sys, 'platform', 'linux'), \
                patch('builtins.open', side_effect=PermissionError('unreadable mountinfo')):
            result = self.remove([self.item(self.file), self.item(self.folder, True)])
        self.assertTrue(all(not item['deleted'] and not item['partial'] for item in result))
        self.assertTrue(all('Cannot inspect runtime mounts' in item['error'] for item in result))
        self.assertTrue(self.file.exists())
        self.assertEqual((self.folder / 'nested/data.txt').read_text(), 'selected')

    def test_non_linux_mount_detection_is_retained(self):
        with patch.object(delete.sys, 'platform', 'darwin'), \
                patch.object(delete.os.path, 'ismount', return_value=True):
            result = self.remove([self.item(self.file), self.item(self.folder, True)])
        self.assertTrue(all(not item['deleted'] for item in result))
        self.assertTrue(self.file.exists())
        self.assertTrue(self.folder.exists())

    def test_cli_batch_writes_error_for_invalid_request(self):
        job = self.root / 'job'
        job.mkdir()
        args = job / 'args.json'
        args.write_text(json.dumps([self.item('/content', True)]))
        result = subprocess.run([sys.executable, str(SCRIPT), '--batch', str(args), str(job)], capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        status = json.loads((job / 'status.json').read_text())
        self.assertEqual(status['state'], 'error')
        self.assertFalse(status['partial'])


class MountTableTests(unittest.TestCase):
    def test_escaped_paths_optional_fields_unicode_and_backslashes(self):
        table = '31 1 0:47 / / rw - overlay overlay rw\n'
        table += r'32 31 0:47 /source /content/café\040x\011y\012z\134040 rw shared:2 future:tag - ext4 /dev/root rw' + '\n'
        with patch.object(delete.sys, 'platform', 'linux'), \
                patch('builtins.open', mock_open(read_data=table)):
            mounts = delete.runtime_mounts()
        self.assertEqual(mounts, {Path('/'), Path('/content/café x\ty\nz\\040')})

    def test_empty_and_malformed_mount_tables_fail_closed(self):
        for table in ['', 'incomplete\n', '31 1 0:47 / relative rw - ext4 /dev/root rw\n',
                      '31 1 0:47 / / rw - ext4\n']:
            with self.subTest(table=table), patch.object(delete.sys, 'platform', 'linux'), \
                    patch('builtins.open', mock_open(read_data=table)), \
                    self.assertRaisesRegex(RuntimeError, 'Nothing was deleted'):
                delete.runtime_mounts()


if __name__ == '__main__':
    unittest.main()
