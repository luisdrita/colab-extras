"""Extract beside an archive; never overwrite or follow links from an archive."""
import contextlib, hashlib, json, os, pathlib, signal, stat, sys, tarfile, time, zipfile

source = pathlib.Path(sys.argv[1]).absolute()
job = pathlib.Path(sys.argv[2]).absolute()
started = time.monotonic()
files = folders = done = 0
MAX_ENTRIES = 100000
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
recovery = None
overwrite = '--overwrite' in sys.argv
overwrite_expected = {}
if '--undo' in sys.argv:
    from recovery import Store, Journal
    recovery_store = Store()
    recovery_lock = recovery_store.locked()
    recovery_lock.__enter__()
    recovery = Journal(recovery_store, 'Extract: ' + source.name)

def report(**data):
    data.update(path=str(source), destination=str(source.parent), files=files,
                folders=folders, done=done, elapsed=round(time.monotonic() - started, 1))
    if recovery:
        data['undo'] = recovery.id
    tmp = job / 'status.tmp'
    tmp.write_text(json.dumps(data), encoding='utf-8')
    os.replace(tmp, job / 'status.json')

def cancel(*args):
    raise InterruptedError('Extraction cancelled')

def check_cancelled():
    if (job / 'cancel').exists():
        cancel()

def member_path(name):
    # Reject Windows separators/drives too, so archives remain unambiguous.
    if not name or name.startswith('/') or '\\' in name or ':' in name or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise ValueError('Unsafe archive path: ' + repr(name))
    parts = tuple(p for p in name.split('/') if p not in ('', '.'))
    if '..' in parts or any(p.startswith('.colab-folder-zip-') for p in parts):
        raise ValueError('Unsafe archive path: ' + repr(name))
    return parts

@contextlib.contextmanager
def directory(root_fd, parts, create=False):
    """Resolve every component relative to an open directory, without symlinks."""
    global folders
    fd = os.dup(root_fd)
    traversed = []
    try:
        for part in parts:
            traversed.append(part)
            check_cancelled()
            if create:
                try:
                    os.mkdir(part, mode=0o755, dir_fd=fd)
                    folders += 1
                    if recovery:
                        recovery.created(source.parent.joinpath(*traversed), directory=True)
                except FileExistsError:
                    pass
            child = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        yield fd
    finally:
        os.close(fd)

def check_destination(root_fd, parts, is_dir):
    try:
        with directory(root_fd, parts[:-1]) as parent:
            try:
                existing = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                return
            if overwrite and recovery and not is_dir and stat.S_ISREG(existing.st_mode):
                if source.parent.joinpath(*parts) == source:
                    raise ValueError('Extraction cannot replace its own archive.')
                overwrite_expected[parts] = recovery.store.fingerprint(source.parent.joinpath(*parts))
                return
            if not (is_dir and stat.S_ISDIR(existing.st_mode)):
                raise FileExistsError('Already exists; nothing was overwritten: ' + '/'.join(parts))
    except FileNotFoundError:
        pass

def extract(root_fd, archive_file):
    global files, done
    name = source.name.lower()
    is_zip = name.endswith('.zip')
    if not is_zip and not name.endswith(('.tar', '.tar.gz', '.tgz')):
        raise ValueError('Supported archives: .zip, .tar, .tar.gz, .tgz')
    opener = zipfile.ZipFile(archive_file) if is_zip else tarfile.open(fileobj=archive_file, mode='r:*')
    with opener as archive:
        entries, types, total = [], {}, 0
        members = archive.infolist() if is_zip else archive
        for index, item in enumerate(members):
            check_cancelled()
            if index >= MAX_ENTRIES:
                raise ValueError('Archive exceeds the 100,000-entry limit')
            parts = member_path(item.filename if is_zip else item.name)
            is_dir = item.is_dir() if is_zip else item.isdir()
            if is_zip:
                mode = (item.external_attr >> 16) & 0xffff
                kind = stat.S_IFMT(mode) if item.create_system == 3 else 0
                if kind not in (0, stat.S_IFDIR if is_dir else stat.S_IFREG):
                    raise ValueError('Archive links and special files are not supported')
                if item.flag_bits & 1:
                    raise ValueError('Password-protected ZIP files are not supported')
                size = item.file_size
            else:
                if not (is_dir or item.isfile()) or item.issparse():
                    raise ValueError('Archive links, sparse files, and special files are not supported')
                size = item.size
            if not parts:
                if is_dir:
                    continue
                raise ValueError('Empty archive filename')
            if parts in types and not (types[parts] and is_dir):
                raise ValueError('Duplicate archive path: ' + '/'.join(parts))
            types[parts] = is_dir
            entries.append((item, parts, is_dir, size))
            if not is_dir:
                total += size
            if index % 500 == 0:
                report(state='checking', total=total)
        # Validate the entire archive and all conflicts before creating anything.
        for _, parts, is_dir, _ in entries:
            check_cancelled()
            if any(types.get(parts[:i]) is False for i in range(1, len(parts))):
                raise ValueError('Archive uses a file as a directory: ' + '/'.join(parts))
            check_destination(root_fd, parts, is_dir)
        space = os.fstatvfs(root_fd)
        if total > space.f_bavail * space.f_frsize:
            raise OSError('Not enough free disk space to extract this archive')
        report(state='extracting', total=total)
        last = time.monotonic()
        for item, parts, is_dir, size in entries:
            check_cancelled()
            with directory(root_fd, parts if is_dir else parts[:-1], create=True) as parent:
                if is_dir:
                    continue
                destination = source.parent.joinpath(*parts)
                replaced = None
                if recovery and overwrite and os.path.lexists(destination):
                    if parts not in overwrite_expected or recovery.store.fingerprint(destination) != overwrite_expected[parts]:
                        raise RuntimeError('Destination changed after extraction preflight; it was preserved.')
                    replaced = recovery.remove(destination, expected=overwrite_expected[parts])
                # O_EXCL also rejects symlinks and files created after preflight.
                fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=parent)
                identity = os.fstat(fd)
                digest = hashlib.sha256()
                copied = 0
                try:
                    with os.fdopen(fd, 'wb') as output:
                        inp = archive.open(item) if is_zip else archive.extractfile(item)
                        with inp:
                            copied = 0
                            while True:
                                check_cancelled()
                                chunk = inp.read(min(1024 * 1024, size - copied + 1))
                                if not chunk:
                                    break
                                if copied + len(chunk) > size:
                                    raise ValueError('Archive entry exceeds its declared size')
                                output.write(chunk)
                                digest.update(chunk)
                                copied += len(chunk)
                                done += len(chunk)
                                if time.monotonic() - last > 0.5:
                                    report(state='extracting', total=total)
                                    last = time.monotonic()
                            if copied != size:
                                raise ValueError('Archive entry is truncated')
                except BaseException:
                    now = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
                    if (now.st_dev, now.st_ino) == (identity.st_dev, identity.st_ino):
                        if not recovery or recovery.store.fingerprint(destination).get('hash') == digest.hexdigest():
                            os.unlink(parts[-1], dir_fd=parent)
                    raise
                files += 1
                if recovery:
                    after = recovery.store.fingerprint(destination)
                    if after['identity'][:2] != [identity.st_dev, identity.st_ino] or after.get('hash') != digest.hexdigest():
                        raise RuntimeError('An extracted file changed during extraction; it was preserved.')
                    if replaced:
                        replaced['after'] = after
                        recovery.save()
                    else:
                        recovery.created(destination, expected=after)
        return total

for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(sig, cancel)
try:
    os.nice(10)
except (AttributeError, OSError):
    pass
try:
    job.mkdir(mode=0o700, parents=True, exist_ok=True)
    (job / 'pid').write_text(str(os.getpid()))
    report(state='checking', total=0)
    check_cancelled()
    with contextlib.ExitStack() as stack:
        root = os.open('/', DIR_FLAGS)
        stack.callback(os.close, root)
        parent = stack.enter_context(directory(root, source.parent.parts[1:]))
        fd = os.open(source.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        archive_file = stack.enter_context(os.fdopen(fd, 'rb'))
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('Select a regular archive file')
        total = extract(parent, archive_file)
        after = os.fstat(fd)
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise RuntimeError('Archive changed during extraction; check the extracted files')
    if recovery:
        recovery.finish()
    report(state='extracted', total=total)
except BaseException as exc:
    rollback = recovery_store.undo(recovery.id) if recovery else None
    report(state='cancelled' if isinstance(exc, InterruptedError) else 'error',
           error=str(exc), partial=bool(rollback['conflicts']) if rollback else bool(files or folders),
           recovery=rollback)
finally:
    try:
        (job / 'pid').unlink()
    except OSError:
        pass
    if recovery:
        recovery_lock.__exit__(None, None, None)
