"""Read folder metadata without reading file contents or following child links."""
import heapq
import json
import os
from pathlib import Path
import signal
import stat
import sys
import time


def scan_folder(value, report=lambda **data: None, cancelled=lambda: False):
    source = Path(value)
    if not source.is_absolute() or source == Path('/') or any(p in ('.', '..') for p in str(value).split('/')):
        raise ValueError('Choose an absolute folder below the filesystem root.')
    if source.name.startswith('.colab-folder-zip-'):
        raise ValueError('Choose your original folder, not an extension job folder.')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    counts = dict(bytes=0, files=0, folders=0, links=0, special=0, skipped=0, excluded=0)
    largest, errors, stack = [], [], []
    started = time.monotonic()
    last_report = 0

    def check():
        if cancelled():
            raise InterruptedError('Folder scan cancelled.')

    def snapshot(state):
        return dict(state=state, path=str(source), **counts,
                    largest=[dict(path=name, size=size) for size, name in sorted(largest, key=lambda x: (-x[0], x[1]))],
                    errors=list(errors), elapsed=round(time.monotonic() - started, 1))

    def tick(force=False):
        nonlocal last_report
        check()
        now = time.monotonic()
        if force or now - last_report >= 0.4:
            report(**snapshot('scanning'))
            last_report = now

    def skipped(name, error):
        counts['skipped'] += 1
        if len(errors) < 5:
            errors.append(dict(path=name, error=str(error)))

    def push(fd, relative):
        try:
            iterator = os.scandir(fd)
        except BaseException:
            os.close(fd)
            raise
        stack.append((fd, iterator, relative))

    try:
        check()
        push(os.open(source, flags), '')
        tick(force=True)
        while stack:
            tick()
            fd, iterator, relative = stack[-1]
            try:
                entry = next(iterator)
            except (StopIteration, OSError) as error:
                if isinstance(error, OSError):
                    skipped(relative or '.', error)
                iterator.close()
                os.close(fd)
                stack.pop()
                continue
            name = relative + '/' + entry.name if relative else entry.name
            try:
                info = entry.stat(follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    if entry.name.startswith('.colab-folder-zip-'):
                        counts['excluded'] += 1
                        continue
                    counts['folders'] += 1
                    # Descriptor-relative, no-follow opens also reject a child
                    # swapped for a symlink between stat and traversal.
                    child = os.open(entry.name, flags, dir_fd=fd)
                    try:
                        current = os.fstat(child)
                        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
                            raise OSError('Folder changed during the scan.')
                    except BaseException:
                        os.close(child)
                        raise
                    push(child, name)
                elif stat.S_ISREG(info.st_mode):
                    counts['files'] += 1
                    counts['bytes'] += info.st_size
                    item = (info.st_size, name)
                    if len(largest) < 10:
                        heapq.heappush(largest, item)
                    else:
                        heapq.heappushpop(largest, item)
                elif stat.S_ISLNK(info.st_mode):
                    counts['links'] += 1
                else:
                    counts['special'] += 1
            except OSError as error:
                skipped(name, error)
        check()
        result = snapshot('details')
        report(**result)
        return result
    finally:
        for fd, iterator, _ in reversed(stack):
            iterator.close()
            os.close(fd)


def main():
    source, directory = sys.argv[1:]
    job = Path(directory)
    def report(**data):
        temporary = job / 'status.tmp'
        temporary.write_text(json.dumps(data), encoding='utf-8')
        os.replace(temporary, job / 'status.json')
    def cancel(*args):
        raise InterruptedError('Folder scan cancelled.')
    for name in ('SIGINT', 'SIGTERM', 'SIGHUP'):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), cancel)
    try:
        try:
            os.nice(10)
        except (AttributeError, OSError):
            pass
        scan_folder(source, report=report, cancelled=lambda: (job / 'cancel').exists())
    except BaseException as error:
        report(state='cancelled' if isinstance(error, InterruptedError) else 'error', error=str(error))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
