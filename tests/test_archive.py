import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile

ARCHIVER = Path(__file__).resolve().parents[1] / 'src/archive.py'

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "results ' café $(touch nope)"
        self.source.mkdir()
        self.job = self.root / '.colab-folder-zip-test'
        self.job.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def run_archive(self, source=None, no_hardlinks=False):
        command = [sys.executable, str(ARCHIVER), str(source or self.source), str(self.job)]
        if no_hardlinks:
            code = "import os,errno,runpy,sys; os.link=lambda *a,**k: (_ for _ in ()).throw(OSError(errno.EXDEV,'cross-device link')); sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0],run_name='__main__')"
            command = [sys.executable, '-c', code, str(ARCHIVER), str(source or self.source), str(self.job)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads((self.job/'status.json').read_text())

    def test_nested_binary_unicode_empty_directories_and_hidden_files(self):
        (self.source/'sub').mkdir()
        (self.source/'empty').mkdir()
        data = bytes(range(256))*1000
        (self.source/'sub'/'data.bin').write_bytes(data)
        (self.source/'.hidden').write_text('included')
        status = self.run_archive()
        self.assertEqual(status['state'], 'ready')
        with zipfile.ZipFile(status['archive']) as z:
            self.assertIsNone(z.testzip())
            self.assertEqual(z.read(self.source.name+'/sub/data.bin'), data)
            self.assertEqual(z.read(self.source.name+'/.hidden'), b'included')
            self.assertIn(self.source.name+'/empty/', z.namelist())
        self.assertEqual(status['files'], 2)
        self.assertFalse((self.job/'pid').exists())
        self.assertFalse((self.job/'archive.partial').exists())

    def test_empty_folder(self):
        status=self.run_archive()
        self.assertEqual(status['state'],'ready')
        with zipfile.ZipFile(status['archive']) as z:
            self.assertEqual(z.namelist(),[self.source.name+'/'])

    def selected_zip(self, *choices):
        args = [{'path': str(path), 'isDirectory': path.is_dir()} for path in choices]
        (self.job / 'args.json').write_text(json.dumps(args))
        return self.run_archive('--selection')

    def test_selection_keeps_shared_relative_paths_and_only_requested_contents(self):
        run_a, run_b = self.source / 'run a', self.source / 'run b'
        run_a.mkdir()
        run_b.mkdir()
        (run_a / 'empty').mkdir()
        (run_a / 'results.csv').write_text('a')
        (run_b / 'results.csv').write_text('b')
        (run_b / 'ignore').write_text('unselected')
        existing = self.root / 'selected-files.zip'
        existing.write_bytes(b'keep')
        status = self.selected_zip(run_b / 'results.csv', run_a, run_a / 'results.csv', run_a)
        self.assertEqual(status['state'], 'ready', status)
        self.assertEqual(Path(status['archive']), self.root / 'selected-files (1).zip')
        self.assertEqual(existing.read_bytes(), b'keep')
        with zipfile.ZipFile(status['archive']) as archive:
            self.assertIsNone(archive.testzip())
            self.assertCountEqual(archive.namelist(), ['run a/', 'run a/empty/', 'run a/results.csv', 'run b/results.csv'])
            self.assertEqual(archive.read('run a/results.csv'), b'a')
            self.assertEqual(archive.read('run b/results.csv'), b'b')

    def test_selection_of_files_preserves_names_and_links(self):
        file = self.source / "café's scores.csv"
        file.write_bytes(b'scores')
        link = self.source / 'link'
        link.symlink_to(file.name)
        status = self.selected_zip(link, file)
        with zipfile.ZipFile(status['archive']) as archive:
            self.assertCountEqual(archive.namelist(), [file.name, link.name])
            self.assertEqual(archive.read(file.name), b'scores')
            self.assertTrue(stat.S_ISLNK(archive.getinfo(link.name).external_attr >> 16))

    def test_invalid_selection_never_publishes_partial_zip(self):
        file = self.source / 'real'
        file.touch()
        alias = self.root / 'alias'
        alias.symlink_to(self.source, target_is_directory=True)
        for invalid in [self.source / 'missing', self.root, self.job / 'args.json', alias / 'real',
                        self.root / '..' / self.root.name / self.source.name / 'real']:
            with self.subTest(invalid=invalid):
                status = self.selected_zip(file, invalid)
                self.assertEqual(status['state'], 'error', status)
                self.assertFalse((self.root / 'selected-files.zip').exists())
                self.assertFalse((self.job / 'archive.partial').exists())

    def test_cancelled_selection_preserves_sources_and_existing_zip(self):
        file = self.source / 'scores.csv'
        file.write_text('keep')
        existing = self.root / 'selected-files.zip'
        existing.write_bytes(b'original')
        (self.job / 'cancel').touch()
        self.assertEqual(self.selected_zip(file, existing)['state'], 'cancelled')
        self.assertEqual(file.read_text(), 'keep')
        self.assertEqual(existing.read_bytes(), b'original')
        self.assertFalse((self.root / 'selected-files (1).zip').exists())

    def test_a_file_replaced_by_a_folder_is_not_included(self):
        other = self.root / 'keep.txt'
        other.touch()
        (self.job / 'args.json').write_text(json.dumps([
            {'path': str(self.source), 'isDirectory': False},
            {'path': str(other), 'isDirectory': False},
        ]))
        status = self.run_archive('--selection')
        self.assertEqual(status['state'], 'error')
        self.assertIn('changed type', status['error'])
        self.assertFalse((self.root / 'selected-files.zip').exists())

    def test_zip_saved_next_to_source_and_existing_archives_preserved(self):
        existing=self.source.with_name(self.source.name+'.zip')
        existing.write_bytes(b'keep this archive')
        (self.source/'a.txt').write_text('new archive')
        status=self.run_archive()
        self.assertEqual(status['state'],'ready')
        self.assertEqual(Path(status['archive']),self.source.with_name(self.source.name+' (1).zip'))
        self.assertEqual(existing.read_bytes(),b'keep this archive')
        with zipfile.ZipFile(status['archive']) as z:
            self.assertEqual(z.read(self.source.name+'/a.txt'),b'new archive')
        self.assertFalse(list(self.job.glob('*.zip')))

    def test_publication_does_not_follow_existing_destination_symlink(self):
        outside=self.root/'keep.txt';outside.write_text('keep me')
        self.source.with_name(self.source.name+'.zip').symlink_to(outside)
        status=self.run_archive()
        self.assertEqual(status['state'],'ready')
        self.assertTrue(status['archive'].endswith(' (1).zip'))
        self.assertEqual(outside.read_text(),'keep me')

    def test_copy_fallback_for_filesystems_without_hard_links(self):
        existing=self.source.with_name(self.source.name+'.zip')
        existing.write_bytes(b'keep this archive')
        (self.source/'a.txt').write_text('copy fallback')
        status=self.run_archive(no_hardlinks=True)
        self.assertEqual(status['state'],'ready')
        self.assertTrue(status['archive'].endswith(' (1).zip'))
        self.assertEqual(existing.read_bytes(),b'keep this archive')
        with zipfile.ZipFile(status['archive']) as z:
            self.assertIsNone(z.testzip())
            self.assertEqual(z.read(self.source.name+'/a.txt'),b'copy fallback')

    def test_links_are_preserved_without_reading_external_target(self):
        outside=self.root/'outside';outside.mkdir()
        (outside/'secret').write_text('not included')
        (self.source/'linked-folder').symlink_to(outside, target_is_directory=True)
        (self.source/'broken').symlink_to('missing')
        status=self.run_archive()
        with zipfile.ZipFile(status['archive']) as z:
            names=z.namelist()
            self.assertEqual(len(names),3)
            info=z.getinfo(self.source.name+'/linked-folder')
            self.assertTrue(stat.S_ISLNK(info.external_attr >> 16))
            self.assertEqual(z.read(info).decode(),str(outside))
            self.assertFalse(any('secret' in name for name in names))

    def test_cancelled_before_scan(self):
        (self.job/'cancel').touch()
        status=self.run_archive()
        self.assertEqual(status['state'],'cancelled')
        self.assertFalse((self.job/'archive.partial').exists())
        self.assertFalse(list(self.job.glob('*.zip')))

    def test_missing_source_reports_error(self):
        self.assertEqual(self.run_archive(self.root/'missing')['state'],'error')

    def test_rejects_root_and_symlink_source(self):
        self.assertEqual(self.run_archive(Path('/'))['state'],'error')
        link=self.root/'link';link.symlink_to(self.source,target_is_directory=True)
        self.assertEqual(self.run_archive(link)['state'],'error')

    def test_staging_folder_is_excluded_when_archiving_parent(self):
        staging=self.source/'.colab-folder-zip-existing';staging.mkdir()
        (staging/'old.zip').write_bytes(b'old')
        (self.source/'normal').write_text('yes')
        status=self.run_archive()
        with zipfile.ZipFile(status['archive']) as z:
            self.assertFalse(any('.colab-folder-zip-' in name for name in z.namelist()))
            self.assertEqual(z.read(self.source.name+'/normal'),b'yes')

    def test_special_file_fails_instead_of_hanging(self):
        os.mkfifo(self.source/'fifo')
        status=self.run_archive()
        self.assertEqual(status['state'],'error')
        self.assertIn('special file',status['error'])

    def test_data_is_compressed(self):
        data=b'compress me\n'*100000
        (self.source/'large.txt').write_bytes(data)
        status=self.run_archive()
        self.assertLess(status['size'],len(data)/10)
        with zipfile.ZipFile(status['archive']) as z:
            self.assertEqual(z.read(self.source.name+'/large.txt'),data)

    @unittest.skipIf(os.geteuid() == 0, 'root can read permission-restricted directories')
    def test_unreadable_directory_fails_instead_of_silently_omitting_files(self):
        locked=self.source/'locked';locked.mkdir()
        (locked/'important.txt').write_text('must not be silently omitted')
        locked.chmod(0)
        try:
            status=self.run_archive()
            self.assertEqual(status['state'],'error')
            self.assertFalse(list(self.job.glob('*.zip')))
        finally:
            locked.chmod(0o700)

if __name__ == '__main__':
    unittest.main(verbosity=2)
