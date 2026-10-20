import base64
import errno
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from recovery import Store, Journal, native


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.store = Store(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def file(self, name='data.txt', text='original'):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        return p

    def call(self, method, path, body=None, **extra):
        return native(self.store, dict(method=method, path=str(path), body=body or {}, **extra))

    def test_delete_restore_tree_and_metadata(self):
        p = self.file('folder/nested/a')
        p.chmod(0o640)
        os.symlink('nested/a', self.root / 'folder/link')
        before = self.store.fingerprint(self.root / 'folder')
        r = self.call('DELETE', self.root / 'folder')
        self.assertFalse((self.root / 'folder').exists())
        self.assertEqual(self.store.undo(r['id'])['state'], 'undone')
        self.assertEqual(self.store.fingerprint(self.root / 'folder'), before)

    def test_creation_undo(self):
        p = self.root / 'new.txt'
        r = self.call('PUT', p, {'content': 'new'})
        self.assertEqual(p.read_text(), 'new')
        self.store.undo(r['id'])
        self.assertFalse(p.exists())

    def test_replace_restore_original_bytes_and_mode(self):
        p = self.file()
        p.chmod(0o600)
        before = self.store.fingerprint(p)
        r = self.call('PUT', p, {'content': 'replaced'})
        self.store.undo(r['id'])
        self.assertEqual(self.store.fingerprint(p), before)

    def test_modified_output_is_preserved(self):
        p = self.file()
        r = self.call('PUT', p, {'content': 'replaced'})
        p.write_text('later work')
        self.assertEqual(self.store.undo(r['id'])['state'], 'conflict')
        self.assertEqual(p.read_text(), 'later work')

    def test_change_between_preflight_and_backup_is_preserved(self):
        p = self.file()
        expected = self.store.fingerprint(p)
        p.write_text('later work')
        journal = Journal(self.store, 'replacement')
        with self.assertRaises(RuntimeError):
            journal.remove(p, expected=expected)
        self.assertEqual(p.read_text(), 'later work')

    def test_changed_output_is_not_recorded_as_owned(self):
        p = self.file()
        expected = self.store.fingerprint(p)
        p.write_text('later work')
        journal = Journal(self.store, 'extraction')
        with self.assertRaises(RuntimeError):
            journal.created(p, expected=expected)
        self.assertEqual(journal.data['changes'], [])

    def test_replaced_identical_bytes_is_preserved(self):
        p = self.root / 'new.txt'
        r = self.call('PUT', p, {'content': 'new'})
        alternate = self.file('replacement', 'new')
        os.replace(alternate, p)
        self.assertEqual(self.store.undo(r['id'])['state'], 'conflict')
        self.assertEqual(p.read_text(), 'new')

    def test_occupied_restore_destination_preserved(self):
        p = self.file()
        r = self.call('DELETE', p)
        p.write_text('another file')
        self.assertEqual(self.store.undo(r['id'])['state'], 'conflict')
        self.assertEqual(p.read_text(), 'another file')

    def test_rename_undo(self):
        p = self.file()
        dest = self.root / 'renamed'
        r = self.call('PATCH', p, {'path': str(dest)})
        self.assertFalse(p.exists())
        self.store.undo(r['id'])
        self.assertEqual(p.read_text(), 'original')
        self.assertFalse(dest.exists())

    def test_move_undo(self):
        p = self.file()
        (self.root / 'other').mkdir()
        dest = self.root / 'other/data'
        r = self.call('PATCH', p, {'path': str(dest)})
        self.store.undo(r['id'])
        self.assertEqual(p.read_text(), 'original')

    def test_cross_filesystem_move_copies_verifies_then_retains_source(self):
        p = self.file()
        dest = self.root / 'moved'
        original_move = self.store.move
        def move(source, destination, expected):
            if Path(source) == p and Path(destination) == dest:
                raise OSError(errno.EXDEV, 'Cross-device link')
            return original_move(source, destination, expected)
        with patch.object(self.store, 'move', move):
            r = self.call('PATCH', p, {'path': str(dest)})
        self.assertFalse(p.exists())
        self.assertEqual(dest.read_text(), 'original')
        self.assertEqual(self.store.undo(r['id'])['state'], 'undone')
        self.assertEqual(p.read_text(), 'original')
        self.assertFalse(dest.exists())

    def test_rename_never_overwrites(self):
        p, dest = self.file(), self.file('occupied', 'keep')
        with self.assertRaises(OSError):
            self.call('PATCH', p, {'path': str(dest)})
        self.assertEqual(p.read_text(), 'original')
        self.assertEqual(dest.read_text(), 'keep')

    def test_copy_folder_undo(self):
        p = self.file('source/a')
        destination = self.root / 'copies'
        destination.mkdir()
        r = self.call('POST', destination, {'copy_from': str(p.parent)})
        self.assertEqual((destination / 'source/a').read_text(), 'original')
        self.store.undo(r['id'])
        self.assertFalse((destination / 'source').exists())
        self.assertEqual(p.read_text(), 'original')

    def test_copy_preserves_later_changes(self):
        p = self.file()
        destination = self.root / 'copies'
        destination.mkdir()
        r = self.call('POST', destination, {'copy_from': str(p)})
        (destination / p.name).write_text('later')
        self.assertEqual(self.store.undo(r['id'])['state'], 'conflict')

    def test_create_folder_and_undo(self):
        parent = self.root / 'parent'
        parent.mkdir()
        r = self.call('POST', parent, {'type': 'directory', 'name': 'new'})
        self.store.undo(r['id'])
        self.assertFalse((parent / 'new').exists())

    def test_create_folder_at_content_root(self):
        r = self.call('POST', self.root, {'type': 'directory', 'name': 'new'})
        self.assertTrue((self.root / 'new').is_dir())
        self.store.undo(r['id'])
        self.assertFalse((self.root / 'new').exists())

    def test_new_folder_with_later_file_is_preserved(self):
        p = self.root / 'new'
        r = self.call('PUT', p, {'type': 'directory'})
        (p / 'later').write_text('keep')
        self.assertEqual(self.store.undo(r['id'])['state'], 'conflict')
        self.assertTrue((p / 'later').exists())

    def test_base64_upload(self):
        p = self.root / 'binary'
        r = self.call('PUT', p, {'format': 'base64', 'content': base64.b64encode(b'\x00\xff').decode()})
        self.assertEqual(p.read_bytes(), b'\x00\xff')
        self.store.undo(r['id'])
        self.assertFalse(p.exists())

    def test_chunked_replace_keeps_original_until_complete(self):
        p = self.file()
        r = self.call('PUT', p, {'chunk': 1, 'content': 'one'})
        self.assertEqual(p.read_text(), 'original')
        self.call('PUT', p, {'chunk': 2, 'content': 'two'}, id=r['id'])
        self.call('PUT', p, {'chunk': -1, 'content': 'three'}, id=r['id'])
        self.assertEqual(p.read_text(), 'onetwothree')
        self.store.undo(r['id'])
        self.assertEqual(p.read_text(), 'original')

    def test_cancel_incomplete_upload_keeps_original(self):
        p = self.file()
        r = self.call('PUT', p, {'chunk': 1, 'content': 'partial'})
        self.store.undo(r['id'])
        self.assertEqual(p.read_text(), 'original')
        with self.assertRaises(RuntimeError):
            self.call('PUT', p, {'chunk': -1, 'content': 'stale completion'}, id=r['id'])
        self.assertEqual(p.read_text(), 'original')

    def test_chunked_upload_destination_conflict(self):
        p = self.file()
        r = self.call('PUT', p, {'chunk': 1, 'content': 'partial'})
        p.write_text('later')
        with self.assertRaises(RuntimeError):
            self.call('PUT', p, {'chunk': -1, 'content': 'rest'}, id=r['id'])
        self.assertEqual(p.read_text(), 'later')

    def test_symlink_parent_is_rejected(self):
        p = self.file('real/file')
        os.symlink(self.root / 'real', self.root / 'alias')
        with self.assertRaises(OSError):
            self.call('DELETE', self.root / 'alias/file')
        self.assertTrue(p.exists())

    def test_changed_backup_is_preserved(self):
        p = self.file()
        r = self.call('DELETE', p)
        backup = Path(self.store.load(r['id'])['changes'][0]['backup'])
        backup.write_text('changed')
        self.assertEqual(self.store.undo(r['id'])['state'], 'conflict')
        self.assertFalse(p.exists())

    def test_multiple_changes_skip_conflicts(self):
        a, b = self.file('a'), self.file('b')
        j = Journal(self.store, 'batch')
        j.created(a);j.created(b);j.finish()
        b.write_text('later')
        result = self.store.undo(j.id)
        self.assertFalse(a.exists())
        self.assertEqual(b.read_text(), 'later')
        self.assertEqual(len(result['conflicts']), 1)

    def test_no_retroactive_or_root_undo(self):
        with self.assertRaises(ValueError):
            self.call('DELETE', self.root)
        with self.assertRaises(ValueError):
            self.call('DELETE', self.store.home)


if __name__ == '__main__':
    unittest.main()
