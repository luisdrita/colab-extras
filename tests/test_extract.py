import io, json, os, pathlib, stat, subprocess, sys, tarfile, tempfile, unittest, zipfile

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'src/extract_archive.py'

class ExtractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name).resolve()
        self.folder = self.root / 'files'
        self.folder.mkdir()
        self.output = self.folder / 'input'
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

    def run_extract(self, path, setup='', flags=()):
        runner = 'import os,sys,runpy,zipfile\nsys.path.insert(0,os.path.dirname(sys.argv[1]))\nimport file_operations\nOriginalStore=file_operations.Store\nfile_operations.Store=lambda:OriginalStore(os.path.dirname(os.path.dirname(sys.argv[2])))\n' + setup + '\nsys.argv=sys.argv[1:]\nrunpy.run_path(sys.argv[0],run_name="__main__")'
        result = subprocess.run([sys.executable, '-c', runner, str(SCRIPT), str(path), str(self.job), *flags], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads((self.job / 'status.json').read_text())

    def test_zip_nested_unicode_hidden_and_empty(self):
        path = self.archive([('résults/file with space.txt', b'hello'), ('.hidden', b'x'), ('empty/', b''), ('zero', b'')])
        result = self.run_extract(path)
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual(result['destination'], str(self.output))
        self.assertEqual(set(self.folder.iterdir()), {path, self.output})
        self.assertEqual(result['files'], 3)
        self.assertEqual(result['done'], 6)
        self.assertEqual((self.output / 'résults/file with space.txt').read_bytes(), b'hello')
        self.assertTrue((self.output / 'empty').is_dir())
        self.assertTrue(path.exists())
        self.assertFalse((self.job / 'pid').exists())

    def test_tar_formats_and_root_directory(self):
        for suffix in ('.tar', '.tar.gz', '.tgz'):
            with self.subTest(suffix=suffix):
                path = self.archive([('./', b''), ('./result'+suffix+'/a', b'data')], suffix)
                result = self.run_extract(path)
                self.assertEqual(result['state'], 'extracted')
                self.assertEqual((pathlib.Path(result['destination']) / ('result'+suffix) / 'a').read_bytes(), b'data')
                self.assertFalse((self.folder / ('result'+suffix)).exists())

    def test_empty_zip(self):
        result = self.run_extract(self.archive([]))
        self.assertEqual((result['state'], result['files'], result['folders']), ('extracted', 0, 0))
        self.assertEqual(list(self.output.iterdir()), [])

    def test_loose_files_stay_in_the_archive_folder(self):
        (self.folder / 'old').write_text('keep')
        result = self.run_extract(self.archive([('new', b'new'), ('old', b'replace')]))
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual((self.output / 'new').read_text(), 'new')
        self.assertEqual((self.output / 'old').read_text(), 'replace')
        self.assertEqual((self.folder / 'old').read_text(), 'keep')

    def test_existing_sibling_directories_are_untouched(self):
        (self.folder / 'results').mkdir()
        (self.folder / 'results/old').write_text('keep')
        result = self.run_extract(self.archive([('results/new', b'new')]))
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual((self.folder / 'results/old').read_text(), 'keep')
        self.assertFalse((self.folder / 'results/new').exists())
        self.assertEqual((self.output / 'results/new').read_text(), 'new')

    def test_archive_cannot_overwrite_itself(self):
        path = self.archive([('input.zip', b'replace')])
        before = path.read_bytes()
        self.assertEqual(self.run_extract(path)['state'], 'extracted')
        self.assertEqual((self.output / 'input.zip').read_bytes(), b'replace')
        self.assertEqual(self.run_extract(path, flags=['--overwrite'])['state'], 'extracted')
        self.assertEqual(path.read_bytes(), before)

    def test_unsafe_names_are_rejected_before_writing(self):
        for name in ('../escape', '/absolute', 'a/../../escape', 'C:/escape', 'a\\escape', 'bad\nname', '.colab-folder-zip-fake/status.json'):
            with self.subTest(name=name):
                result = self.run_extract(self.archive([('safe', b'a'), (name, b'x')]))
                self.assertEqual(result['state'], 'error')
                self.assertFalse(result['partial'])
                self.assertFalse(self.output.exists())
        self.assertFalse((self.root / 'escape').exists())

    def test_tar_traversal_rejected(self):
        result = self.run_extract(self.archive([('safe', b'a'), ('../escape', b'b')], '.tar'))
        self.assertEqual(result['state'], 'error')
        self.assertFalse(self.output.exists())

    def test_zip_symlink_and_special_files_rejected(self):
        for kind in (stat.S_IFLNK, stat.S_IFIFO):
            info = zipfile.ZipInfo('link')
            info.create_system = 3
            info.external_attr = (kind | 0o777) << 16
            result = self.run_extract(self.archive([('safe', b'a'), (info, b'../outside')]))
            self.assertEqual(result['state'], 'error')
            self.assertFalse(self.output.exists())

    def test_tar_links_and_special_files_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE):
            path = self.folder / 'input.tar'
            with tarfile.open(path, 'w') as t:
                info = tarfile.TarInfo('link');info.type=kind;info.linkname='../outside';t.addfile(info)
            self.assertEqual(self.run_extract(path)['state'], 'error')
            self.assertFalse((self.folder / 'link').exists())

    def test_destination_symlink_never_followed(self):
        outside = self.root / 'outside';outside.mkdir()
        self.output.symlink_to(outside, target_is_directory=True)
        result = self.run_extract(self.archive([('escape', b'bad')]))
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual((self.folder / 'input (1)/escape').read_bytes(), b'bad')

    def test_broken_symlink_not_overwritten(self):
        link = self.output;link.symlink_to(self.root / 'missing')
        result = self.run_extract(self.archive([('result', b'bad')]))
        self.assertEqual(result['state'], 'extracted')
        self.assertTrue(link.is_symlink())
        self.assertEqual((self.folder / 'input (1)/result').read_bytes(), b'bad')

    def test_source_symlink_rejected(self):
        source = self.archive([('result', b'bad')])
        link = self.folder / 'link.zip';link.symlink_to(source)
        self.assertEqual(self.run_extract(link)['state'], 'error')
        self.assertFalse(self.output.exists())

    def test_source_symlink_parent_rejected(self):
        source = self.archive([('result', b'bad')])
        link = self.root / 'linked';link.symlink_to(self.folder, target_is_directory=True)
        self.assertEqual(self.run_extract(link / source.name)['state'], 'error')

    def test_duplicate_files_and_file_directory_conflicts(self):
        for entries in ([('x', b'a'), ('./x', b'b')], [('x/y', b'a'), ('x', b'b')], [('x/', b''), ('x', b'b')]):
            result = self.run_extract(self.archive(entries))
            self.assertEqual(result['state'], 'error')
            self.assertFalse(self.output.exists())

    def test_flat_archive_repeated_extraction_numbers_the_whole_folder(self):
        archive = self.archive([('one.csv', b'first'), ('two.txt', b'second')])
        for output in (self.output, self.folder / 'input (1)'):
            result = self.run_extract(archive)
            self.assertEqual(result['destination'], str(output))
            self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()},
                             {'one.csv': b'first', 'two.txt': b'second'})
        self.assertEqual({p.name for p in self.folder.iterdir()}, {'input.zip', 'input', 'input (1)'})

    def test_matching_directory_with_loose_sibling_keeps_its_structure(self):
        archive = self.archive([('input/', b''), ('input/old', b'inner'), ('old', b'outer')])
        result = self.run_extract(archive)
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual((self.output / 'input/old').read_bytes(), b'inner')
        self.assertEqual((self.output / 'old').read_bytes(), b'outer')
        self.assertEqual(set(self.folder.iterdir()), {self.output, archive})

    def test_single_file_with_the_same_name_as_its_archive_stem(self):
        archive = self.archive([('input', b'file')])
        self.assertEqual(self.run_extract(archive)['state'], 'extracted')
        self.assertEqual((self.output / 'input').read_bytes(), b'file')

    def test_whole_extension_removed_and_archive_basename_case_preserved(self):
        for stem, ext, expected in [('Run.02', '.TAR.GZ', 'Run.02'), ('', '.zip', 'archive'),
                                    ('.', '.zip', 'archive (1)'), ('..', '.zip', 'archive (2)')]:
            with self.subTest(stem=stem, ext=ext):
                archive = self.archive([('file', b'data')], ext.lower()).rename(self.folder / (stem + ext))
                result = self.run_extract(archive)
                self.assertEqual(result['state'], 'extracted')
                self.assertEqual(result['destination'], str(self.folder / expected))
                self.assertEqual((self.folder / expected / 'file').read_bytes(), b'data')

    def test_regular_file_collision_is_preserved_even_with_replacement_enabled(self):
        archive = self.archive([('file', b'data')])
        self.output.write_text('existing regular file')
        result = self.run_extract(archive, flags=['--overwrite'])
        self.assertEqual(result['destination'], str(self.folder / 'input (1)'))
        self.assertEqual((self.folder / 'input (1)/file').read_bytes(), b'data')
        self.assertEqual(self.output.read_text(), 'existing regular file')

    def test_existing_file_used_as_parent(self):
        (self.folder / 'parent').write_text('keep')
        result = self.run_extract(self.archive([('parent/child', b'bad')]))
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual((self.folder / 'parent').read_text(), 'keep')
        self.assertEqual((self.output / 'parent/child').read_bytes(), b'bad')

    def test_pre_cancelled_job_does_not_write(self):
        (self.job / 'cancel').touch()
        result = self.run_extract(self.archive([('result', b'data')]))
        self.assertEqual(result['state'], 'cancelled')
        self.assertFalse(result['partial'])
        self.assertFalse(self.output.exists())

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
        self.assertFalse(result['partial'])
        self.assertEqual(result['files'], 1)
        self.assertFalse((self.folder / 'complete').exists())
        self.assertFalse(self.output.exists())
        self.assertTrue(path.exists())

    def test_corrupt_zip_removes_incomplete_file(self):
        path = self.archive([('result', b'unique payload')])
        data = path.read_bytes().replace(b'unique payload', b'broken payload')
        path.write_bytes(data)
        self.assertEqual(self.run_extract(path)['state'], 'error')
        self.assertFalse(self.output.exists())

    def test_invalid_archive(self):
        path = self.folder / 'invalid.zip';path.write_text('not a zip')
        self.assertEqual(self.run_extract(path)['state'], 'error')

    def test_insufficient_disk_space(self):
        setup = 'from types import SimpleNamespace\nos.fstatvfs=lambda fd:SimpleNamespace(f_bavail=0,f_frsize=4096)'
        result = self.run_extract(self.archive([('result', b'data')]), setup)
        self.assertEqual(result['state'], 'error')
        self.assertIn('free disk space', result['error'])
        self.assertFalse(self.output.exists())

    def test_file_created_after_preflight_is_preserved(self):
        setup = '''
original_open=os.open
output_path=os.path.join(os.path.dirname(sys.argv[2]),'input','result')
def safe_open(path,flags,*a,**kw):
    if path=='result' and flags & os.O_EXCL:
        with open(output_path,'w') as f:f.write('created by another process')
    return original_open(path,flags,*a,**kw)
os.open=safe_open
'''
        result = self.run_extract(self.archive([('result', b'bad')]), setup)
        self.assertEqual(result['state'], 'error')
        self.assertTrue(result['partial'])
        self.assertEqual((self.output / 'result').read_text(), 'created by another process')
        self.assertFalse((self.folder / 'result').exists())

    def test_existing_sample_data_zip_extracts_complete_numbered_siblings(self):
        original = self.folder / 'sample_data'
        original.mkdir()
        (original / 'README.md').write_text('keep existing README')
        (self.folder / 'sample_data (1)').mkdir()
        archive = self.archive([('sample_data/README.md', b'archive README'),
                                ('sample_data/nested/data.csv', b'a,b\n1,2'),
                                ('sample_data/empty/', b'')])
        archive = archive.rename(self.folder / 'sample_data.zip')
        before = archive.read_bytes()
        for number in (2, 3):
            result = self.run_extract(archive)
            self.assertEqual(result['state'], 'extracted')
            copied = self.folder / ('sample_data (' + str(number) + ')')
            self.assertEqual((copied / 'README.md').read_bytes(), b'archive README')
            self.assertEqual((copied / 'nested/data.csv').read_bytes(), b'a,b\n1,2')
            self.assertTrue((copied / 'empty').is_dir())
        self.assertEqual((original / 'README.md').read_text(), 'keep existing README')
        self.assertFalse((original / 'nested').exists())
        self.assertEqual(archive.read_bytes(), before)
        self.assertEqual(list(self.root.rglob('.colab-folder-zip-*')), [])

    def test_similarly_named_member_directories_stay_separate(self):
        (self.folder / 'results').mkdir()
        archive = self.archive([('results/a', b'first root'), ('results (1)/b', b'second root')])
        self.assertEqual(self.run_extract(archive)['state'], 'extracted')
        self.assertEqual((self.output / 'results/a').read_bytes(), b'first root')
        self.assertEqual((self.output / 'results (1)/b').read_bytes(), b'second root')
        self.assertFalse((self.output / 'results (1)/a').exists())
        self.assertEqual(list((self.folder / 'results').iterdir()), [])

    def test_loose_files_keep_original_names_and_extensions(self):
        (self.folder / 'data.csv').write_text('existing')
        archive = self.archive([('data.csv', b'first'), ('data (1).csv', b'second')])
        self.assertEqual(self.run_extract(archive)['state'], 'extracted')
        self.assertEqual((self.folder / 'data.csv').read_text(), 'existing')
        self.assertEqual((self.output / 'data.csv').read_bytes(), b'first')
        self.assertEqual((self.output / 'data (1).csv').read_bytes(), b'second')

    def test_tar_formats_duplicate_existing_folders(self):
        for suffix in ('.tar', '.tar.gz', '.tgz'):
            name = 'folder' + suffix
            (self.folder / name).mkdir()
            archive = self.archive([(name + '/file', b'contents')], suffix).rename(self.folder / (name + suffix))
            self.assertEqual(self.run_extract(archive)['state'], 'extracted')
            self.assertEqual((self.folder / (name + ' (1)') / 'file').read_bytes(), b'contents')
            self.assertEqual(list((self.folder / name).iterdir()), [])

    def test_concurrent_folder_creation_gets_a_new_number_without_merging(self):
        setup = '''
original_mkdir=os.mkdir
def mkdir(path,*args,**kwargs):
    if path=='results':
        original_mkdir(path,*args,**kwargs)
        fd=os.open('results',os.O_RDONLY|os.O_DIRECTORY,dir_fd=kwargs['dir_fd'])
        try:
            marker=os.open('concurrent.txt',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644,dir_fd=fd)
            os.close(marker)
        finally:
            os.close(fd)
    return original_mkdir(path,*args,**kwargs)
os.mkdir=mkdir
'''
        archive = self.archive([('data', b'archive data')]).rename(self.folder / 'results.zip')
        self.assertEqual(self.run_extract(archive, setup)['state'], 'extracted')
        self.assertTrue((self.folder / 'results/concurrent.txt').exists())
        self.assertFalse((self.folder / 'results/data').exists())
        self.assertEqual((self.folder / 'results (1)/data').read_bytes(), b'archive data')

    def test_cancelled_duplicate_extraction_preserves_original_and_removes_partial_copy(self):
        original = self.folder / 'results'
        original.mkdir()
        (original / 'file').write_text('keep')
        archive = self.archive([('results/file', b'from archive'), ('results/large', b'x' * 2097152)]).rename(self.folder / 'results.zip')
        setup = '''
original_read=zipfile.ZipExtFile.read
cancel_path=os.path.join(sys.argv[3],'cancel')
def read(self,n=-1):
    data=original_read(self,n)
    if self.name=='results/large' and data:
        open(cancel_path,'w').close()
    return data
zipfile.ZipExtFile.read=read
'''
        result = self.run_extract(archive, setup)
        self.assertEqual(result['state'], 'cancelled')
        self.assertFalse(result['partial'])
        self.assertEqual((original / 'file').read_text(), 'keep')
        self.assertFalse((self.folder / 'results (1)').exists())
        self.assertEqual(list(self.root.rglob('.colab-folder-zip-*')), [])

    def test_successful_replacement_removes_temporary_originals(self):
        self.output.mkdir()
        (self.output / 'old').write_text('original')
        (self.folder / 'old').write_text('sibling')
        path = self.archive([('old', b'replacement'), ('nested/new', b'new')])
        result = self.run_extract(path, flags=['--overwrite'])
        self.assertEqual(result['state'], 'extracted')
        self.assertEqual((self.output / 'old').read_text(), 'replacement')
        self.assertEqual((self.output / 'nested/new').read_text(), 'new')
        self.assertEqual((self.folder / 'old').read_text(), 'sibling')
        self.assertEqual(list(self.root.rglob('.colab-folder-zip-*')), [])

    def test_status_failure_after_commit_does_not_remove_completed_output(self):
        self.output.mkdir()
        (self.output / 'old').write_text('original')
        path = self.archive([('old', b'replacement')])
        setup = '''
import json
original_dumps=json.dumps
def dumps(value,*args,**kwargs):
    if isinstance(value,dict) and value.get('state')=='extracted':
        raise OSError('status write fixture')
    return original_dumps(value,*args,**kwargs)
json.dumps=dumps
'''
        result = self.run_extract(path, setup, flags=['--overwrite'])
        self.assertEqual(result['state'], 'error')
        self.assertTrue(result['partial'])
        self.assertEqual((self.output / 'old').read_text(), 'replacement')
        self.assertEqual(list(self.root.rglob('.colab-folder-zip-*')), [])

    def test_cancelled_replacement_restores_original_and_cleans_staging(self):
        self.output.mkdir()
        (self.output / 'old').write_text('original')
        path = self.archive([('old', b'replacement'), ('nested/large', b'x' * 2097152)])
        setup = '''
original_read=zipfile.ZipExtFile.read
cancel_path=os.path.join(sys.argv[3],'cancel')
original_path=os.path.join(os.path.dirname(sys.argv[2]),'input','old')
def read(self,n=-1):
    data=original_read(self,n)
    if self.name=='nested/large' and data:
        open(cancel_path,'w').close()
    return data
zipfile.ZipExtFile.read=read
'''
        result = self.run_extract(path, setup, flags=['--overwrite'])
        self.assertEqual(result['state'], 'cancelled')
        self.assertFalse(result['partial'])
        self.assertEqual((self.output / 'old').read_text(), 'original')
        self.assertFalse((self.output / 'nested').exists())
        self.assertEqual(list(self.root.rglob('.colab-folder-zip-*')), [])

    def test_rollback_preserves_later_edit_and_retains_original_with_location(self):
        self.output.mkdir()
        (self.output / 'old').write_text('original')
        path = self.archive([('old', b'replacement'), ('large', b'x' * 2097152)])
        setup = '''
original_read=zipfile.ZipExtFile.read
cancel_path=os.path.join(sys.argv[3],'cancel')
original_path=os.path.join(os.path.dirname(sys.argv[2]),'input','old')
def read(self,n=-1):
    data=original_read(self,n)
    if self.name=='large' and data:
        with open(original_path,'w') as f:
            f.write('later edit')
        open(cancel_path,'w').close()
    return data
zipfile.ZipExtFile.read=read
'''
        result = self.run_extract(path, setup, flags=['--overwrite'])
        self.assertEqual(result['state'], 'cancelled')
        self.assertTrue(result['partial'])
        self.assertEqual((self.output / 'old').read_text(), 'later edit')
        self.assertTrue(result['temporary_originals'])
        retained = [p.read_bytes() for folder in result['temporary_originals']
                    for p in pathlib.Path(folder).iterdir() if p.is_file()]
        self.assertIn(b'original', retained)

if __name__ == '__main__':
    unittest.main()
