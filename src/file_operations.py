"""Temporary staging and rollback for in-flight extraction.

No completed-operation history or user-triggered reversal is retained.
"""
import contextlib
import ctypes
import hashlib
import os
from pathlib import Path
import shutil
import stat
import uuid

PREFIX = '.colab-folder-zip-'
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def rename_exclusive(src, dst, src_fd, dst_fd):
    """Atomic no-replace rename, including directories. Fail closed otherwise."""
    libc = ctypes.CDLL(None, use_errno=True)
    if hasattr(libc, 'renameat2'):
        result = libc.renameat2(src_fd, os.fsencode(src), dst_fd, os.fsencode(dst), 1)
    elif hasattr(libc, 'renameatx_np'):  # macOS local test fixtures
        result = libc.renameatx_np(src_fd, os.fsencode(src), dst_fd, os.fsencode(dst), 4)
    else:
        raise OSError('This filesystem cannot safely rename without overwriting.')
    if result:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


class Store:
    def __init__(self, root=Path('/content')):
        self.root = Path(root).absolute()

    def path(self, value, internal=False):
        p = Path(value)
        if not p.is_absolute() or any(c in str(value) for c in ('\x00',)) or any(
                ord(c) < 32 or ord(c) == 127 for c in str(value)):
            raise ValueError('Choose an absolute path inside /content.')
        if any(c in ('.', '..') for c in str(value).split('/')):
            raise ValueError('Relative path components are not supported.')
        parts = p.relative_to(self.root).parts
        if not parts or (not internal and any(c.startswith(PREFIX) for c in parts)):
            raise ValueError('Runtime roots and temporary folders are protected.')
        if parts[0] == 'drive' and (len(parts) == 1 or
                (parts[1] == 'MyDrive' and len(parts) == 2) or
                (parts[1] == 'Shareddrives' and len(parts) <= 3)):
            raise ValueError('Drive roots are protected.')
        return p

    @contextlib.contextmanager
    def parent(self, path):
        # Pin all ancestors. No symlink traversal, even if a parent is swapped.
        fd = os.open('/', FLAGS)
        try:
            for part in Path(path).parent.parts[1:]:
                child = os.open(part, FLAGS, dir_fd=fd)
                os.close(fd)
                fd = child
            yield fd
        finally:
            os.close(fd)

    def fingerprint(self, path):
        """Content hash plus identity/metadata. Changes during hashing fail."""
        path = Path(path)
        with self.parent(path) as parent:
            return self._fingerprint(parent, path.name)

    def _fingerprint(self, parent, name):
        try:
            before = os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return None
        identity = [before.st_dev, before.st_ino, before.st_mode]
        if stat.S_ISLNK(before.st_mode):
            return {'kind': 'link', 'identity': identity, 'target': os.readlink(name, dir_fd=parent)}
        if stat.S_ISREG(before.st_mode):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            with os.fdopen(fd, 'rb') as inp:
                if os.fstat(inp.fileno()).st_ino != before.st_ino:
                    raise RuntimeError('File was replaced during verification.')
                h = hashlib.sha256()
                for chunk in iter(lambda: inp.read(1024 * 1024), b''):
                    h.update(chunk)
                after = os.fstat(inp.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise RuntimeError('File changed during verification.')
            return {'kind': 'file', 'identity': identity, 'size': before.st_size,
                    'mtime': before.st_mtime_ns, 'hash': h.hexdigest()}
        if stat.S_ISDIR(before.st_mode):
            fd = os.open(name, FLAGS, dir_fd=parent)
            try:
                if os.fstat(fd).st_ino != before.st_ino:
                    raise RuntimeError('Directory was replaced during verification.')
                names = sorted(os.listdir(fd))
                children = {}
                for child in names:
                    value = self._fingerprint(fd, child)
                    if value is None:
                        raise RuntimeError('Folder changed during verification.')
                    if value['identity'][0] != before.st_dev:
                        raise ValueError('Folders containing mount points are not supported.')
                    children[child] = value
                if names != sorted(os.listdir(fd)):
                    raise RuntimeError('Folder changed during verification.')
                return {'kind': 'directory', 'identity': identity, 'children': children}
            finally:
                os.close(fd)
        raise ValueError('Special files are not supported.')

    def move(self, source, destination, expected):
        source, destination = Path(source), Path(destination)
        with self.parent(source) as sf, self.parent(destination) as df:
            if self._fingerprint(sf, source.name) != expected:
                raise RuntimeError('The item changed; it was preserved.')
            rename_exclusive(source.name, destination.name, sf, df)

    def rollback(self, transaction):
        d = transaction.data
        conflicts = []
        for change in reversed(d['changes']):
            if change.get('rolled_back'):
                continue
            path = self.path(change['path'])
            try:
                if change['kind'] == 'directory':
                    with self.parent(path) as parent:
                        now = self._fingerprint(parent, path.name)
                        if now is None:
                            pass
                        elif now['identity'] != change['after']['identity'] or now.get('children'):
                            raise RuntimeError('The folder contains later changes.')
                        else:
                            os.rmdir(path.name, dir_fd=parent)
                else:
                    now = self.fingerprint(path)
                    if now is None and not change.get('published', True) and not change.get('backup'):
                        change['rolled_back'] = True
                        continue
                    # If publication failed after backing up the original, its
                    # empty location can still be restored without deleting data.
                    unpublished = now is None and change.get('backup') and not change.get('published', True)
                    if now != change.get('after') and not unpublished:
                        raise RuntimeError('The item was changed or replaced after this action.')
                    backup = change.get('backup')
                    if backup:
                        backup = self.path(backup, internal=True)
                        if self.fingerprint(backup) != change['before']:
                            raise RuntimeError('The temporary original was changed or is unavailable.')
                    if now is not None:
                        bucket = self.path(change['bucket'], internal=True)
                        discarded = bucket / ('discarded-' + uuid.uuid4().hex)
                        self.move(path, discarded, now)
                    if backup:
                        try:
                            self.move(backup, path, change['before'])
                        except BaseException:
                            # Restore the visible output if restoring the original failed.
                            if now is not None and self.fingerprint(path) is None:
                                self.move(discarded, path, now)
                            raise
                change['rolled_back'] = True
            except (OSError, ValueError, RuntimeError) as error:
                conflicts.append({'path': str(path), 'reason': str(error)})
        d['state'] = 'conflict' if conflicts else 'rolled_back'
        if not conflicts:
            try:
                transaction.clean()
            except (OSError, RuntimeError) as error:
                conflicts.append({'path': ', '.join(map(str, transaction.buckets)), 'reason': str(error)})
        return {'state': d['state'], 'conflicts': conflicts}

class Transaction:
    def __init__(self, store, label):
        self.store = store
        self.id = str(uuid.uuid4())
        self.data = {'label': label, 'state': 'pending', 'changes': []}
        self.buckets = {}

    def clean(self):
        # Only this operation's private staging directories are disposable.
        for bucket, identity in self.buckets.items():
            with self.store.parent(bucket) as parent:
                try:
                    before = os.stat(bucket.name, dir_fd=parent, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if (before.st_dev, before.st_ino) != identity or not stat.S_ISDIR(before.st_mode):
                    raise RuntimeError('Temporary directory was replaced; it was preserved.')
                # rmtree is symlink-resistant on supported hosted runtimes.
                if not shutil.rmtree.avoids_symlink_attacks:
                    raise RuntimeError('Safe temporary-file cleanup is unavailable.')
                previous = os.open('.', FLAGS)
                try:
                    os.fchdir(parent)
                    shutil.rmtree(bucket.name)
                finally:
                    os.fchdir(previous)
                    os.close(previous)

    def finish(self):
        self.data['state'] = 'complete'
        try:
            self.clean()
        except (OSError, RuntimeError):
            # The operation already succeeded. Leave staging for manual cleanup.
            pass

    def bucket(self, path):
        path = Path(path)
        parts = path.relative_to(self.store.root).parts
        anchor = self.store.root
        if parts[:2] == ('drive', 'MyDrive'):
            anchor = self.store.root / 'drive' / 'MyDrive'
        elif parts[:2] == ('drive', 'Shareddrives') and len(parts) > 3:
            anchor = self.store.root.joinpath(*parts[:3])
        # A custom mount keeps its temporary files on that filesystem.
        for ancestor in reversed(path.parent.parents):
            if ancestor != self.store.root and self.store.root in ancestor.parents and os.path.ismount(ancestor):
                anchor = ancestor
        if os.path.ismount(path.parent):
            anchor = path.parent
        bucket = anchor / (PREFIX + 'transaction-' + self.id)
        with self.store.parent(bucket) as parent:
            try:
                os.mkdir(bucket.name, 0o700, dir_fd=parent)
            except FileExistsError:
                pass
            fd = os.open(bucket.name, FLAGS, dir_fd=parent)
            info = os.fstat(fd)
            os.close(fd)
        identity = (info.st_dev, info.st_ino)
        if bucket in self.buckets and self.buckets[bucket] != identity:
            raise RuntimeError('Temporary directory was replaced; it was preserved.')
        self.buckets[bucket] = identity
        return bucket

    def created(self, path, directory=False, expected=None):
        path = self.store.path(str(path))
        after = self.store.fingerprint(path)
        if expected is not None and after != expected:
            raise RuntimeError('The created item changed before recording; it was preserved.')
        change = {'kind': 'directory' if directory else 'write',
                  'path': str(path), 'after': after,
                  'bucket': str(self.bucket(path))}
        self.data['changes'].append(change)
        return change

    def remove(self, path, expected=None):
        path = self.store.path(str(path))
        before = self.store.fingerprint(path)
        if expected is not None and before != expected:
            raise RuntimeError('The item changed before replacement; it was preserved.')
        if before is None:
            raise FileNotFoundError(str(path))
        if os.path.ismount(path):
            raise ValueError('Mount points are protected.')
        bucket = self.bucket(path)
        backup = bucket / uuid.uuid4().hex
        change = {'kind': 'write', 'path': str(path), 'before': before,
                  'backup': str(backup), 'bucket': str(bucket), 'after': None}
        self.data['changes'].append(change)
        self.store.move(path, backup, before)
        return change
