import json
import errno
from pathlib import Path
import runpy
import signal
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from recovery import Store

SRC = Path(__file__).resolve().parents[1] / 'src'


class WorkerRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.store = Store(self.root)
        self.job = self.root / '.colab-folder-zip-job'
        self.job.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def run_worker(self, script, source, *flags):
        handlers = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
        try:
            with patch('recovery.Store', return_value=self.store), patch.object(
                    sys, 'argv', [script, str(source), str(self.job), '--undo', *flags]):
                runpy.run_path(str(SRC / script), run_name='__main__')
        finally:
            for s, handler in handlers.items():
                signal.signal(s, handler)
        return json.loads((self.job / 'status.json').read_text())

    def archive(self, entries):
        p = self.root / 'data.zip'
        with zipfile.ZipFile(p, 'w') as out:
            for name, content in entries.items():
                out.writestr(name, content)
        return p

    def test_zip_undo_exact_archive(self):
        folder = self.root / 'folder'
        folder.mkdir()
        (folder / 'a').write_text('source')
        result = self.run_worker('archive.py', folder)
        self.assertEqual(result['state'], 'ready')
        self.assertEqual(self.store.undo(result['undo'])['state'], 'undone')
        self.assertFalse(Path(result['archive']).exists())
        self.assertEqual((folder / 'a').read_text(), 'source')

    def test_zip_modified_after_completion_is_kept(self):
        folder = self.root / 'folder'
        folder.mkdir()
        result = self.run_worker('archive.py', folder)
        Path(result['archive']).write_bytes(b'new content')
        self.assertEqual(self.store.undo(result['undo'])['state'], 'conflict')

    def test_zip_collision_preserves_existing_archive(self):
        folder = self.root / 'folder'
        folder.mkdir()
        occupied = self.root / 'folder.zip'
        occupied.write_text('keep')
        result = self.run_worker('archive.py', folder)
        self.assertEqual(result['state'], 'ready')
        self.assertEqual(Path(result['archive']).name, 'folder (1).zip')
        self.store.undo(result['undo'])
        self.assertEqual(occupied.read_text(), 'keep')

    def test_zip_cross_filesystem_publication_has_recoverable_identity(self):
        folder = self.root / 'folder'
        folder.mkdir()
        original_move = self.store.move
        def move(source, destination, expected):
            if Path(source).parent == self.job:
                raise OSError(errno.EXDEV, 'Cross-device link')
            return original_move(source, destination, expected)
        with patch.object(self.store, 'move', move):
            result = self.run_worker('archive.py', folder)
        self.assertEqual(result['state'], 'ready')
        self.assertTrue(zipfile.is_zipfile(result['archive']))
        self.assertEqual(self.store.undo(result['undo'])['state'], 'undone')
        self.assertFalse(Path(result['archive']).exists())

    def test_extraction_undo_removes_only_created_files_and_dirs(self):
        archive = self.archive({'nested/a': 'A', 'empty/': '', 'b': 'B'})
        result = self.run_worker('extract_archive.py', archive)
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual(self.store.undo(result['undo'])['state'], 'undone')
        self.assertFalse((self.root / 'nested').exists())
        self.assertFalse((self.root / 'empty').exists())
        self.assertTrue(archive.exists())

    def test_extraction_conflicts_keep_later_edits_and_unrelated_files(self):
        archive = self.archive({'nested/a': 'A', 'b': 'B'})
        result = self.run_worker('extract_archive.py', archive)
        (self.root / 'nested/a').write_text('edited')
        (self.root / 'nested/later').write_text('keep')
        self.assertEqual(self.store.undo(result['undo'])['state'], 'conflict')
        self.assertEqual((self.root / 'nested/a').read_text(), 'edited')
        self.assertTrue((self.root / 'nested/later').exists())
        self.assertFalse((self.root / 'b').exists())

    def test_overwrite_extract_undo_restores_original(self):
        archive = self.archive({'a': 'replacement'})
        original = self.root / 'a'
        original.write_text('original')
        original.chmod(0o640)
        before = self.store.fingerprint(original)
        result = self.run_worker('extract_archive.py', archive, '--overwrite')
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual(original.read_text(), 'replacement')
        self.assertEqual(self.store.undo(result['undo'])['state'], 'undone')
        self.assertEqual(self.store.fingerprint(original), before)

    def test_cancel_after_first_file_restores_originals(self):
        archive = self.archive({'a': 'replacement', 'b': 'second'})
        original = self.root / 'a'
        original.write_text('original')
        opener = zipfile.ZipFile.open
        def interrupt(zip_file, item, *args, **kwargs):
            if getattr(item, 'filename', item) == 'b':
                raise InterruptedError('Extraction cancelled')
            return opener(zip_file, item, *args, **kwargs)
        with patch.object(zipfile.ZipFile, 'open', interrupt):
            result = self.run_worker('extract_archive.py', archive, '--overwrite')
        self.assertEqual(result['state'], 'cancelled')
        self.assertFalse(result['partial'])
        self.assertEqual(original.read_text(), 'original')
        self.assertFalse((self.root / 'b').exists())


if __name__ == '__main__':
    unittest.main()
