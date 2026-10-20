"""Runtime-local recovery journal. No operation follows symbolic-link parents.

Undo quarantines outputs rather than destroying them. Recovery data lives on the
same filesystem as the changed file; the index lives in the current runtime.
"""
import base64
import contextlib
import ctypes
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import time
import uuid

PREFIX = '.colab-folder-zip-'
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def atomic_json(path, value):
    tmp = path.with_suffix('.tmp')
    with tmp.open('w', encoding='utf-8') as out:
        json.dump(value, out, ensure_ascii=True)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)


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


def content_signature(value):
    if isinstance(value, dict):
        return {k: content_signature(v) for k, v in value.items() if k != 'identity'}
    return value


def verified_copy(store, source, staged, expected):
    if expected is None or expected['kind'] == 'link':
        raise ValueError('Choose a regular file or folder.')
    if expected['kind'] == 'directory':
        shutil.copytree(source, staged, symlinks=True)
    else:
        # The staging filename is private to this operation.
        with staged.open('xb'):
            pass
        shutil.copy2(source, staged, follow_symlinks=False)
    if store.fingerprint(source) != expected:
        raise RuntimeError('Source changed during copying; source was preserved.')
    after = store.fingerprint(staged)
    if content_signature(expected) != content_signature(after):
        raise RuntimeError('The copy could not be verified; source was preserved.')
    return after


class Store:
    def __init__(self, root=Path('/content')):
        self.root = Path(root).absolute()
        self.home = self.root / (PREFIX + 'undo')
        self.home.mkdir(mode=0o700, exist_ok=True)
        if self.home.is_symlink():
            raise ValueError('Recovery storage must not be a symbolic link.')

    @contextlib.contextmanager
    def locked(self):
        fd = os.open(self.home / 'lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    def path(self, value, internal=False):
        p = Path(value)
        if not p.is_absolute() or any(c in str(value) for c in ('\x00',)) or any(
                ord(c) < 32 or ord(c) == 127 for c in str(value)):
            raise ValueError('Choose an absolute path inside /content.')
        if any(c in ('.', '..') for c in str(value).split('/')):
            raise ValueError('Relative path components are not supported.')
        parts = p.relative_to(self.root).parts
        if not parts or (not internal and any(c.startswith(PREFIX) for c in parts)):
            raise ValueError('Runtime roots and recovery folders are protected.')
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

    def load(self, ident):
        if not isinstance(ident, str) or str(uuid.UUID(ident)) != ident:
            raise ValueError('Invalid recovery record.')
        data = json.loads((self.home / (ident + '.json')).read_text())
        if data['id'] != ident:
            raise ValueError('Invalid recovery record.')
        return data

    def list(self):
        records = []
        for file in self.home.glob('*.json'):
            try:
                d = self.load(file.stem)
                if d['state'] != 'undone':
                    item = {k: d[k] for k in ('id', 'label', 'time', 'state')}
                    paths = [c['path'] for c in d['changes'] if not c.get('undone')]
                    item.update(paths=paths[:5], count=len(paths))
                    records.append(item)
            except (OSError, ValueError, KeyError):
                continue
        return sorted(records, key=lambda d: d['time'], reverse=True)

    def undo(self, ident):
        d = self.load(ident)
        conflicts = []
        for change in reversed(d['changes']):
            if change.get('undone'):
                continue
            path = self.path(change['path'])
            try:
                if change['kind'] == 'move':
                    source = self.path(change['source'])
                    if self.fingerprint(source) == change['after'] and self.fingerprint(path) is None:
                        change['undone'] = True
                        atomic_json(self.home / (ident + '.json'), d)
                        continue
                    if self.fingerprint(source) is not None:
                        raise RuntimeError('The original location is occupied.')
                    self.move(path, source, change['after'])
                elif change['kind'] == 'directory':
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
                        change['undone'] = True
                        atomic_json(self.home / (ident + '.json'), d)
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
                            raise RuntimeError('The recovery copy was changed or is unavailable.')
                    if now is not None:
                        bucket = self.path(change['bucket'], internal=True)
                        discarded = bucket / ('undone-' + uuid.uuid4().hex)
                        self.move(path, discarded, now)
                    if backup:
                        try:
                            self.move(backup, path, change['before'])
                        except BaseException:
                            # Restore the visible output if restoring the original failed.
                            if now is not None and self.fingerprint(path) is None:
                                self.move(discarded, path, now)
                            raise
                change['undone'] = True
                atomic_json(self.home / (ident + '.json'), d)
            except (OSError, ValueError, RuntimeError) as error:
                conflicts.append({'path': str(path), 'reason': str(error)})
        d['state'] = 'conflict' if conflicts else 'undone'
        atomic_json(self.home / (ident + '.json'), d)
        return {'id': ident, 'state': d['state'], 'conflicts': conflicts}


class Journal:
    def __init__(self, store, label, ident=None):
        self.store = store
        self.data = store.load(ident) if ident else {
            'id': str(uuid.uuid4()), 'label': label, 'time': time.time(),
            'state': 'pending', 'changes': []}
        if ident and self.data['state'] != 'pending':
            raise RuntimeError('This operation has finished or was cancelled; restart the upload.')
        self.save()

    @property
    def id(self):
        return self.data['id']

    def save(self):
        atomic_json(self.store.home / (self.id + '.json'), self.data)

    def bucket(self, path):
        path = Path(path)
        parts = path.relative_to(self.store.root).parts
        anchor = self.store.root
        if parts[:2] == ('drive', 'MyDrive'):
            anchor = self.store.root / 'drive' / 'MyDrive'
        elif parts[:2] == ('drive', 'Shareddrives') and len(parts) > 3:
            anchor = self.store.root.joinpath(*parts[:3])
        # A custom mount keeps its recovery files on that filesystem.
        for ancestor in reversed(path.parent.parents):
            if ancestor != self.store.root and self.store.root in ancestor.parents and os.path.ismount(ancestor):
                anchor = ancestor
        if os.path.ismount(path.parent):
            anchor = path.parent
        bucket = anchor / (PREFIX + 'recovery-' + self.id)
        with self.store.parent(bucket) as parent:
            try:
                os.mkdir(bucket.name, 0o700, dir_fd=parent)
            except FileExistsError:
                pass
            fd = os.open(bucket.name, FLAGS, dir_fd=parent)
            os.close(fd)
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
        self.save()
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
        # Save intent first. A crash before the rename is a conflict, never a
        # licence to delete whichever file later appears at this path.
        self.data['changes'].append(change)
        self.save()
        self.store.move(path, backup, before)
        return change

    def write(self, path, payload, replace=False):
        path = self.store.path(str(path))
        before = self.store.fingerprint(path)
        if before is not None and (not replace or before['kind'] != 'file'):
            raise FileExistsError('Destination exists; nothing was overwritten.')
        bucket = self.bucket(path)
        staged = bucket / ('staged-' + uuid.uuid4().hex)
        with staged.open('xb') as out:
            out.write(payload)
            out.flush()
            os.fsync(out.fileno())
        if before is not None:
            change = self.remove(path, expected=before)
        else:
            change = {'kind': 'write', 'path': str(path), 'after': None, 'bucket': str(bucket)}
            self.data['changes'].append(change)
        # Record the exact staged fingerprint before making it visible.
        change['after'] = self.store.fingerprint(staged)
        change['published'] = False
        self.save()
        self.store.move(staged, path, change['after'])
        change['published'] = True
        self.save()
        return change

    def finish(self):
        self.data['state'] = 'ready'
        self.save()
        return self.id


def native(store, args):
    method = args['method']
    if method == 'POST':
        path = Path(args['path'])
        if not path.is_absolute() or any(p in ('.', '..') or p.startswith(PREFIX) for p in args['path'].split('/')):
            raise ValueError('Invalid destination folder.')
        path.relative_to(store.root)
        with store.parent(path / '_new_item') as parent:
            pass
    else:
        path = store.path(args['path'])
    body = args.get('body') or {}
    journal = Journal(store, args.get('label', method + ' ' + path.name), args.get('id'))
    try:
        if method == 'DELETE':
            journal.remove(path)
        elif method == 'PATCH':
            destination = store.path('/' + body['path'].lstrip('/'))
            if destination == path or path in destination.parents:
                raise ValueError('Choose a different destination outside this folder.')
            before = store.fingerprint(path)
            if before is None:
                raise FileNotFoundError(str(path))
            journal.data['changes'].append({'kind': 'move', 'source': str(path),
                                           'path': str(destination), 'after': before})
            journal.save()
            try:
                store.move(path, destination, before)
            except OSError as error:
                if error.errno != errno.EXDEV:
                    raise
                # Cross-filesystem move: verify a complete copy before touching
                # the source, then keep that source in recoverable storage.
                journal.data['changes'].pop()
                journal.save()
                bucket = journal.bucket(destination)
                staged = bucket / ('move-' + uuid.uuid4().hex)
                after = verified_copy(store, path, staged, before)
                journal.remove(path, expected=before)
                change = {'kind': 'write', 'path': str(destination), 'after': after,
                          'bucket': str(bucket), 'published': False}
                journal.data['changes'].append(change)
                journal.save()
                store.move(staged, destination, after)
                change['published'] = True
                journal.save()
            path = destination
        elif method == 'POST':
            # Jupyter new/copy requests address the destination directory.
            if body.get('copy_from'):
                source = store.path('/' + body['copy_from'].lstrip('/'))
                name = body.get('name') or source.name
            else:
                source = None
                name = body.get('name') or ('Untitled Folder' if body.get('type') == 'directory' else 'untitled.txt')
            if (not isinstance(name, str) or Path(name).name != name or name in ('.', '..')
                    or name.startswith(PREFIX) or any(ord(c) < 32 or ord(c) == 127 for c in name)):
                raise ValueError('Invalid new item name.')
            destination = path / name
            i = 1
            while store.fingerprint(destination) is not None:
                destination = path / (Path(name).stem + ' (' + str(i) + ')' + Path(name).suffix)
                i += 1
            if source:
                if source == destination or source in destination.parents:
                    raise ValueError('Cannot copy a folder into itself.')
                expected = store.fingerprint(source)
                bucket = journal.bucket(destination)
                staged = bucket / 'copy'
                after = verified_copy(store, source, staged, expected)
                change = {'kind': 'write', 'path': str(destination),
                          'after': after, 'bucket': str(bucket), 'published': False}
                journal.data['changes'].append(change)
                journal.save()
                store.move(staged, destination, after)
                change['published'] = True
                journal.save()
            elif body.get('type') == 'directory':
                with store.parent(destination) as parent:
                    os.mkdir(destination.name, 0o755, dir_fd=parent)
                journal.created(destination, directory=True)
            else:
                journal.write(destination, b'')
            path = destination
        elif method == 'PUT':
            if body.get('type') == 'directory':
                with store.parent(path) as parent:
                    os.mkdir(path.name, 0o755, dir_fd=parent)
                journal.created(path, directory=True)
            else:
                fmt = body.get('format', 'text')
                content = body.get('content', '')
                if fmt == 'base64':
                    payload = base64.b64decode(content, validate=True)
                elif fmt == 'text' and isinstance(content, str):
                    payload = content.encode('utf-8')
                elif fmt == 'json':
                    payload = json.dumps(content).encode('utf-8')
                else:
                    raise ValueError('Unsupported upload format.')
                chunk = body.get('chunk')
                if chunk is not None:
                    bucket = journal.bucket(path)
                    staged = bucket / 'upload'
                    if chunk == 1:
                        journal.data['upload'] = {'path': str(path), 'before': store.fingerprint(path), 'next': 2}
                        with staged.open('xb') as out:
                            out.write(payload)
                    else:
                        upload = journal.data.get('upload')
                        if not upload or upload['path'] != str(path) or (chunk != -1 and chunk != upload['next']):
                            raise ValueError('Upload chunks arrived out of order.')
                        with staged.open('ab') as out:
                            out.write(payload)
                        upload['next'] += 1
                    journal.save()
                    if chunk != -1:
                        return {'id': journal.id, 'path': str(path), 'state': 'pending'}
                    if store.fingerprint(path) != journal.data['upload']['before']:
                        raise RuntimeError('Destination changed during upload.')
                    # Publish without reading the complete upload into memory.
                    before = store.fingerprint(path)
                    change = journal.remove(path, expected=before) if before else {
                        'kind': 'write', 'path': str(path), 'bucket': str(bucket)}
                    if not before:
                        journal.data['changes'].append(change)
                    change['after'] = store.fingerprint(staged)
                    change['published'] = False
                    journal.save()
                    store.move(staged, path, change['after'])
                    change['published'] = True
                    journal.save()
                else:
                    journal.write(path, payload, replace=True)
        else:
            raise ValueError('Unsupported file operation; no changes made.')
        return {'id': journal.finish(), 'path': str(path), 'state': 'ready'}
    except BaseException:
        # Completed steps are recoverable; automatic rollback preserves conflicts.
        store.undo(journal.id)
        raise


def main():
    args_file, result_file = map(Path, sys.argv[1:3])
    try:
        atomic_json(result_file, {'running': True})
        args = json.loads(args_file.read_text())
        store = Store()
        with store.locked():
            if args['action'] == 'list':
                result = {'records': store.list(), 'server_time': time.time()}
            elif args['action'] == 'undo':
                result = store.undo(args['id'])
            elif args['action'] == 'native':
                result = native(store, args)
            else:
                raise ValueError('Unknown recovery action.')
        result['ok'] = True
    except BaseException as error:
        result = {'ok': False, 'error': str(error)}
    atomic_json(result_file, result)


if __name__ == '__main__':
    main()
