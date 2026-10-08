import io, json, os, pathlib, stat, subprocess, sys, tarfile, tempfile, unittest, zipfile

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'src/extract_archive.py'

class ExtractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name).resolve()
        self.folder = self.root / 'files'
        self.folder.mkdir()
        self.job = self.root / 'job'
        self.job.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, entries, suffix='.zip'):
        path = self.folder / ('input' + suffix)
        if suffix == '.zip':
            with zipfile.ZipFile(path, 'w') as z:
                for name, data in entries:
                    z.writestr(name, data)
        else:
            with tarfile.open(path, 'w:gz' if suffix != '.tar' else 'w') as t:
                for name, data in entries:
                    info = tarfile.TarInfo(name)
                    if name.endswith('/'):
                        info.type = tarfile.DIRTYPE
                    else:
                        info.size = len(data)
                    t.addfile(info, io.BytesIO(data))
        return path

    def run_extract(self, path, setup=''):
        runner = 'import os,sys,runpy,zipfile\n' + setup + '\nsys.argv=sys.argv[1:]\nrunpy.run_path(sys.argv[0],run_name="__main__")'
        result = subprocess.run([sys.executable, '-c', runner, str(SCRIPT), str(path), str(self.job)], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads((self.job / 'status.json').read_text())

    def test_zip_nested_unicode_hidden_and_empty(self):
        path = self.archive([('résults/file with space.txt', b'hello'), ('.hidden', b'x'), ('empty/', b''), ('zero', b'')])
        result = self.run_extract(path)
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual(result['destination'], str(self.folder))
        self.assertEqual(result['files'], 3)
        self.assertEqual(result['done'], 6)
        self.assertEqual((self.folder / 'résults/file with space.txt').read_bytes(), b'hello')
        self.assertTrue((self.folder / 'empty').is_dir())
        self.assertTrue(path.exists())
        self.assertFalse((self.job / 'pid').exists())

    def test_tar_formats_and_root_directory(self):
        for suffix in ('.tar', '.tar.gz', '.tgz'):
            with self.subTest(suffix=suffix):
                path = self.archive([('./', b''), ('./result'+suffix+'/a', b'data')], suffix)
                self.assertEqual(self.run_extract(path)['state'], 'extracted')
                self.assertEqual((self.folder / ('result'+suffix) / 'a').read_bytes(), b'data')

    def test_empty_zip(self):
        result = self.run_extract(self.archive([]))
        self.assertEqual((result['state'], result['files'], result['folders']), ('extracted', 0, 0))

    def test_existing_file_aborts_before_any_write(self):
        (self.folder / 'old').write_text('keep')
        result = self.run_extract(self.archive([('new', b'new'), ('old', b'replace')]))
        self.assertEqual(result['state'], 'error')
        self.assertFalse(result['partial'])
        self.assertFalse((self.folder / 'new').exists())
        self.assertEqual((self.folder / 'old').read_text(), 'keep')

    def test_existing_directories_merge(self):
        (self.folder / 'results').mkdir()
        (self.folder / 'results/old').write_text('keep')
        result = self.run_extract(self.archive([('results/new', b'new')]))
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual((self.folder / 'results/old').read_text(), 'keep')

    def test_archive_cannot_overwrite_itself(self):
        path = self.archive([('input.zip', b'replace')])
        before = path.read_bytes()
        self.assertEqual(self.run_extract(path)['state'], 'error')
        self.assertEqual(path.read_bytes(), before)

    def test_unsafe_names_are_rejected_before_writing(self):
        for name in ('../escape', '/absolute', 'a/../../escape', 'C:/escape', 'a\\escape', 'bad\nname', '.colab-folder-zip-fake/status.json'):
            with self.subTest(name=name):
                result = self.run_extract(self.archive([('safe', b'a'), (name, b'x')]))
                self.assertEqual(result['state'], 'error')
                self.assertFalse(result['partial'])
                self.assertFalse((self.folder / 'safe').exists())
        self.assertFalse((self.root / 'escape').exists())

    def test_tar_traversal_rejected(self):
        result = self.run_extract(self.archive([('safe', b'a'), ('../escape', b'b')], '.tar'))
        self.assertEqual(result['state'], 'error')
        self.assertFalse((self.folder / 'safe').exists())

    def test_zip_symlink_and_special_files_rejected(self):
        for kind in (stat.S_IFLNK, stat.S_IFIFO):
            info = zipfile.ZipInfo('link')
            info.create_system = 3
            info.external_attr = (kind | 0o777) << 16
            result = self.run_extract(self.archive([('safe', b'a'), (info, b'../outside')]))
            self.assertEqual(result['state'], 'error')
            self.assertFalse((self.folder / 'safe').exists())

    def test_tar_links_and_special_files_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE):
            path = self.folder / 'input.tar'
            with tarfile.open(path, 'w') as t:
                info = tarfile.TarInfo('link');info.type=kind;info.linkname='../outside';t.addfile(info)
            self.assertEqual(self.run_extract(path)['state'], 'error')
            self.assertFalse((self.folder / 'link').exists())

    def test_destination_symlink_never_followed(self):
        outside = self.root / 'outside';outside.mkdir()
        (self.folder / 'results').symlink_to(outside, target_is_directory=True)
        result = self.run_extract(self.archive([('results/escape', b'bad')]))
        self.assertEqual(result['state'], 'error')
        self.assertEqual(list(outside.iterdir()), [])

    def test_broken_symlink_not_overwritten(self):
        link = self.folder / 'result';link.symlink_to(self.root / 'missing')
        result = self.run_extract(self.archive([('result', b'bad')]))
        self.assertEqual(result['state'], 'error')
        self.assertTrue(link.is_symlink())

    def test_source_symlink_rejected(self):
        source = self.archive([('result', b'bad')])
        link = self.folder / 'link.zip';link.symlink_to(source)
        self.assertEqual(self.run_extract(link)['state'], 'error')
        self.assertFalse((self.folder / 'result').exists())

    def test_source_symlink_parent_rejected(self):
        source = self.archive([('result', b'bad')])
        link = self.root / 'linked';link.symlink_to(self.folder, target_is_directory=True)
        self.assertEqual(self.run_extract(link / source.name)['state'], 'error')

    def test_duplicate_files_and_file_directory_conflicts(self):
        for entries in ([('x', b'a'), ('./x', b'b')], [('x/y', b'a'), ('x', b'b')], [('x/', b''), ('x', b'b')]):
            result = self.run_extract(self.archive(entries))
            self.assertEqual(result['state'], 'error')
            self.assertFalse((self.folder / 'x').exists())

    def test_existing_file_used_as_parent(self):
        (self.folder / 'parent').write_text('keep')
        result = self.run_extract(self.archive([('parent/child', b'bad')]))
        self.assertEqual(result['state'], 'error')
        self.assertEqual((self.folder / 'parent').read_text(), 'keep')

    def test_pre_cancelled_job_does_not_write(self):
        (self.job / 'cancel').touch()
        result = self.run_extract(self.archive([('result', b'data')]))
        self.assertEqual(result['state'], 'cancelled')
        self.assertFalse(result['partial'])
        self.assertFalse((self.folder / 'result').exists())

    def test_cancel_during_file_removes_incomplete_file(self):
        path = self.archive([('complete', b'good'), ('incomplete', b'x' * (3 * 1024 * 1024))])
        setup = '''
original_read=zipfile.ZipExtFile.read
cancel_path=os.path.join(sys.argv[3],'cancel')
def read(self,n=-1):
    data=original_read(self,n)
    if self.name=='incomplete' and data:
        open(cancel_path,'w').close()
    return data
zipfile.ZipExtFile.read=read
'''
        result = self.run_extract(path, setup)
        self.assertEqual(result['state'], 'cancelled')
        self.assertTrue(result['partial'])
        self.assertEqual(result['files'], 1)
        self.assertEqual((self.folder / 'complete').read_bytes(), b'good')
        self.assertFalse((self.folder / 'incomplete').exists())
        self.assertTrue(path.exists())

    def test_corrupt_zip_removes_incomplete_file(self):
        path = self.archive([('result', b'unique payload')])
        data = path.read_bytes().replace(b'unique payload', b'broken payload')
        path.write_bytes(data)
        self.assertEqual(self.run_extract(path)['state'], 'error')
        self.assertFalse((self.folder / 'result').exists())

    def test_invalid_archive(self):
        path = self.folder / 'invalid.zip';path.write_text('not a zip')
        self.assertEqual(self.run_extract(path)['state'], 'error')

    def test_insufficient_disk_space(self):
        setup = 'from types import SimpleNamespace\nos.fstatvfs=lambda fd:SimpleNamespace(f_bavail=0,f_frsize=4096)'
        result = self.run_extract(self.archive([('result', b'data')]), setup)
        self.assertEqual(result['state'], 'error')
        self.assertIn('free disk space', result['error'])
        self.assertFalse((self.folder / 'result').exists())

    def test_file_created_after_preflight_is_preserved(self):
        setup = '''
original_open=os.open
output_path=os.path.join(os.path.dirname(sys.argv[2]),'result')
def safe_open(path,flags,*a,**kw):
    if path=='result' and flags & os.O_EXCL:
        with open(output_path,'w') as f:f.write('created by another process')
    return original_open(path,flags,*a,**kw)
os.open=safe_open
'''
        result = self.run_extract(self.archive([('result', b'bad')]), setup)
        self.assertEqual(result['state'], 'error')
        self.assertEqual((self.folder / 'result').read_text(), 'created by another process')

if __name__ == '__main__':
    unittest.main()
