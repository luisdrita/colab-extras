import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'src/folder_details.py'
spec = importlib.util.spec_from_file_location('folder_details', SCRIPT)
details = importlib.util.module_from_spec(spec)
spec.loader.exec_module(details)


class DetailsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "results ' café $(touch nope)"
        self.source.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def scan(self, **kwargs):
        return details.scan_folder(str(self.source), **kwargs)

    def test_nested_hidden_empty_unicode_and_literal_names(self):
        (self.source / 'empty').mkdir()
        (self.source / '.hidden').mkdir()
        (self.source / '.hidden/café.txt').write_bytes(b'12345')
        (self.source / '<img onerror=alert(1)>.txt').write_bytes(b'123')
        reports = []
        result = self.scan(report=lambda **r: reports.append(r))
        self.assertEqual((result['bytes'], result['files'], result['folders']), (8, 2, 2))
        self.assertEqual(result['largest'][0], dict(path='.hidden/café.txt', size=5))
        self.assertEqual((reports[0]['state'], reports[-1]['state']), ('scanning', 'details'))
        self.assertEqual(result['skipped'], 0)
        self.assertFalse((self.root / 'nope').exists())

    def test_empty_folder(self):
        result = self.scan()
        self.assertEqual(result['bytes'], 0)
        self.assertEqual(result['folders'], 0)
        self.assertEqual(result['largest'], [])

    def test_top_ten_are_largest_files_with_relative_paths(self):
        for n in range(25):
            (self.source / str(n)).write_bytes(b'x' * n)
        result = self.scan()
        self.assertEqual(result['files'], 25)
        self.assertEqual(result['bytes'], sum(range(25)))
        self.assertEqual([f['size'] for f in result['largest']], list(range(24, 14, -1)))

    def test_child_links_broken_links_and_loops_are_not_followed(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'large').write_bytes(b'x' * 1000)
        (self.source / 'folder-link').symlink_to(outside, target_is_directory=True)
        (self.source / 'file-link').symlink_to(outside / 'large')
        (self.source / 'loop').symlink_to(self.source, target_is_directory=True)
        (self.source / 'broken').symlink_to('missing')
        result = self.scan()
        self.assertEqual((result['bytes'], result['files'], result['folders'], result['links']), (0, 0, 0, 4))

    def test_selected_symlink_file_missing_and_root_are_rejected(self):
        link = self.root / 'link'
        link.symlink_to(self.source, target_is_directory=True)
        file = self.root / 'file'
        file.touch()
        for path in [link, file, self.root / 'missing', '/', 'relative']:
            with self.subTest(path=path), self.assertRaises((OSError, ValueError)):
                details.scan_folder(str(path))

    def test_own_staging_directories_are_excluded_but_other_hidden_files_count(self):
        staging = self.source / '.colab-folder-zip-job'
        staging.mkdir()
        (staging / 'script').write_bytes(b'large' * 100)
        (self.source / '.hidden').write_bytes(b'123')
        result = self.scan()
        self.assertEqual((result['bytes'], result['files'], result['folders'], result['excluded']), (3, 1, 0, 1))

    def test_hard_links_and_sparse_files_use_logical_bytes_per_path(self):
        original = self.source / 'sparse'
        with original.open('wb') as f:
            f.truncate(10 * 1024 * 1024)
        os.link(original, self.source / 'hard-link')
        result = self.scan()
        self.assertEqual(result['bytes'], 20 * 1024 * 1024)
        self.assertEqual(result['files'], 2)

    def test_scan_opens_only_directories_and_does_not_modify_user_files(self):
        path = self.source / 'file'
        path.write_bytes(b'unchanged')
        before = path.stat()
        real_open = details.os.open
        def open_directory(name, flags, *args, **kwargs):
            self.assertTrue(flags & os.O_DIRECTORY)
            self.assertTrue(flags & os.O_NOFOLLOW)
            return real_open(name, flags, *args, **kwargs)
        with patch.object(details.os, 'open', side_effect=open_directory):
            result = self.scan()
        self.assertEqual(result['bytes'], 9)
        self.assertEqual(path.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(path.read_bytes(), b'unchanged')

    def test_unreadable_subfolder_produces_partial_totals_with_error(self):
        (self.source / 'blocked').mkdir()
        (self.source / 'blocked/missing-from-total').write_bytes(b'12345')
        (self.source / 'readable').write_bytes(b'123')
        real_open = details.os.open
        def open_directory(name, *args, **kwargs):
            if name == 'blocked':
                raise PermissionError('Permission denied')
            return real_open(name, *args, **kwargs)
        with patch.object(details.os, 'open', side_effect=open_directory):
            result = self.scan()
        self.assertEqual((result['bytes'], result['files'], result['folders'], result['skipped']), (3, 1, 1, 1))
        self.assertEqual(result['errors'][0]['path'], 'blocked')

    def test_directory_swapped_for_symlink_is_not_traversed(self):
        (self.source / 'child').mkdir()
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'do-not-count').write_bytes(b'large' * 100)
        real_open = details.os.open
        def swap_before_open(name, *args, **kwargs):
            if name == 'child':
                (self.source / 'child').rename(self.root / 'original')
                (self.source / 'child').symlink_to(outside, target_is_directory=True)
            return real_open(name, *args, **kwargs)
        with patch.object(details.os, 'open', side_effect=swap_before_open):
            result = self.scan()
        self.assertEqual(result['bytes'], 0)
        self.assertEqual(result['skipped'], 1)

    def test_fifo_is_counted_separately_without_opening_or_blocking(self):
        os.mkfifo(self.source / 'pipe')
        result = self.scan()
        self.assertEqual((result['special'], result['files'], result['bytes']), (1, 0, 0))

    def test_scan_cancels_between_entries_and_closes_directories(self):
        for n in range(30):
            (self.source / str(n)).touch()
        calls = 0
        def cancelled():
            nonlocal calls
            calls += 1
            return calls > 5
        with self.assertRaises(InterruptedError):
            self.scan(cancelled=cancelled)
        self.assertEqual(self.scan()['files'], 30)

    def test_cli_success_cancellation_and_error_status(self):
        (self.source / 'file').write_bytes(b'1234')
        for kind in ['success', 'cancelled', 'error']:
            job = self.root / kind
            job.mkdir()
            if kind == 'cancelled':
                (job / 'cancel').touch()
            source = self.source if kind != 'error' else self.root / 'missing'
            process = subprocess.run([sys.executable, str(SCRIPT), str(source), str(job)], capture_output=True, timeout=10)
            result = json.loads((job / 'status.json').read_text())
            self.assertEqual(result['state'], 'details' if kind == 'success' else kind)
            self.assertEqual(process.returncode, 0 if kind == 'success' else 1)
            if kind == 'success':
                self.assertEqual(result['bytes'], 4)


if __name__ == '__main__':
    unittest.main(verbosity=2)
