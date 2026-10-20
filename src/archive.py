import errno, json, os, pathlib, signal, stat, sys, time, zipfile

source = pathlib.Path(sys.argv[1]).absolute()
job = pathlib.Path(sys.argv[2]).absolute()
status = job / 'status.json'
archive = job / (source.name + '.zip')
partial = job / 'archive.partial'
started = time.monotonic()
recovery = None
if '--undo' in sys.argv:
    from recovery import Store, Journal, verified_copy
    recovery_store = Store()
    recovery_lock = recovery_store.locked()
    recovery_lock.__enter__()
    recovery = Journal(recovery_store, 'Create ZIP: ' + source.name)

def report(**data):
    data['elapsed'] = round(time.monotonic() - started, 1)
    tmp = job / 'status.tmp'
    tmp.write_text(json.dumps(data), encoding='utf-8')
    os.replace(tmp, status)

def cancel(*args):
    raise InterruptedError('Compression cancelled')

def check_cancelled():
    if (job / 'cancel').exists():
        cancel()

def walk_error(error):
    raise error

def publish_archive(staged):
    """Keep the ZIP beside the source without ever replacing an existing path."""
    index = 0
    while True:
        check_cancelled()
        suffix = '' if index == 0 else ' (' + str(index) + ')'
        destination = source.parent / (source.name + suffix + '.zip')
        if recovery:
            # Journal the exact completed archive before publication. Atomic
            # rename avoids exposing a partly copied ZIP on mounted filesystems.
            bucket = recovery.bucket(destination)
            expected = recovery_store.fingerprint(staged)
            change = {'kind': 'write', 'path': str(destination), 'after': expected,
                      'bucket': str(bucket), 'published': False}
            recovery.data['changes'].append(change)
            recovery.save()
            try:
                try:
                    recovery_store.move(staged, destination, expected)
                except OSError as error:
                    if error.errno != errno.EXDEV:
                        raise
                    copied = bucket / ('zip-' + str(index))
                    expected = verified_copy(recovery_store, staged, copied, expected)
                    change['after'] = expected
                    recovery.save()
                    check_cancelled()
                    recovery_store.move(copied, destination, expected)
            except FileExistsError:
                recovery.data['changes'].pop()
                recovery.save()
                index += 1
                continue
            change['published'] = True
            recovery.save()
            return destination
        try:
            # Same filesystem: publish the completed archive atomically.
            os.link(staged, destination)
            return destination
        except FileExistsError:
            index += 1
            continue
        except OSError as error:
            if error.errno not in (errno.EXDEV, errno.EPERM, errno.EOPNOTSUPP, errno.ENOSYS):
                raise
        # Mounted Drive and other filesystems may not support hard links.
        # Exclusive creation still prevents overwriting files or symlinks.
        try:
            output = destination.open('xb')
        except FileExistsError:
            index += 1
            continue
        try:
            copied = 0
            last_report = 0
            size = staged.stat().st_size
            with output, staged.open('rb') as inp:
                while True:
                    check_cancelled()
                    chunk = inp.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
                    copied += len(chunk)
                    if time.monotonic() - last_report > 0.5:
                        report(state='saving', done=copied, total=size)
                        last_report = time.monotonic()
            return destination
        except BaseException:
            destination.unlink(missing_ok=True)
            raise

signal.signal(signal.SIGTERM, cancel)
signal.signal(signal.SIGINT, cancel)
if hasattr(signal, 'SIGHUP'):
    signal.signal(signal.SIGHUP, cancel)
try:
    os.nice(10)
except (AttributeError, OSError):
    pass
try:
    job.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not source.is_dir() or source.is_symlink() or source == pathlib.Path('/'):
        raise ValueError('Select a regular folder below the filesystem root')
    if source.name.startswith('.colab-folder-zip-'):
        raise ValueError('Select your original folder, not a ZIP staging folder')
    (job / 'pid').write_text(str(os.getpid()))
    report(state='scanning')
    entries = []
    total = 0
    for current, dirs, files in os.walk(source, followlinks=False, onerror=walk_error):
        check_cancelled()
        current = pathlib.Path(current)
        dirs.sort(); files.sort()
        # Do not include this extension's staging folders or follow symbolic links.
        dirs[:] = [d for d in dirs if not d.startswith('.colab-folder-zip-')]
        for name in list(dirs):
            p = current / name
            if p.is_symlink():
                entries.append((p, p.lstat()))
                dirs.remove(name)
        entries.append((current, current.lstat()))
        for name in files:
            check_cancelled()
            p = current / name
            st = p.lstat()
            if not (stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode)):
                raise ValueError('Cannot archive special file: ' + str(p))
            entries.append((p, st))
            if stat.S_ISREG(st.st_mode): total += st.st_size
    done = 0
    last = 0
    count = 0
    with zipfile.ZipFile(partial, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True, strict_timestamps=False) as z:
        for p, before in entries:
            check_cancelled()
            rel = str(p.relative_to(source.parent))
            if stat.S_ISLNK(before.st_mode):
                info = zipfile.ZipInfo(rel)
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                z.writestr(info, os.readlink(p).encode('utf-8'))
                count += 1
            elif stat.S_ISDIR(before.st_mode):
                z.write(p, rel + '/')
            else:
                # Refuse a symlink swapped in after enumeration.
                fd = os.open(p, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
                with os.fdopen(fd, 'rb') as inp:
                    now = os.fstat(inp.fileno())
                    if (before.st_ino, before.st_size, before.st_mtime_ns) != (now.st_ino, now.st_size, now.st_mtime_ns):
                        raise RuntimeError('File changed before compression: ' + str(p))
                    info = zipfile.ZipInfo.from_file(p, rel, strict_timestamps=False)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info._compresslevel = 1
                    with z.open(info, 'w', force_zip64=True) as out:
                        while True:
                            check_cancelled()
                            chunk = inp.read(1024 * 1024)
                            if not chunk: break
                            out.write(chunk); done += len(chunk)
                            if time.monotonic() - last > 0.5:
                                report(state='compressing', done=done, total=total, files=count)
                                last = time.monotonic()
                    after = os.fstat(inp.fileno())
                    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                        raise RuntimeError('File changed during compression: ' + str(p))
                count += 1
    os.replace(partial, archive)
    saved = publish_archive(archive)
    if recovery:
        recovery.finish()
    archive.unlink(missing_ok=True)
    report(state='ready', archive=str(saved), size=saved.stat().st_size, done=done, total=total, files=count,
           undo=recovery.id if recovery else None)
except BaseException as exc:
    try: partial.unlink(missing_ok=True)
    except OSError: pass
    try: archive.unlink(missing_ok=True)
    except OSError: pass
    if recovery:
        recovery_store.undo(recovery.id)
    report(state='cancelled' if isinstance(exc, InterruptedError) else 'error', error=str(exc))
finally:
    try: (job / 'pid').unlink(missing_ok=True)
    except OSError: pass
    if recovery:
        recovery_lock.__exit__(None, None, None)
