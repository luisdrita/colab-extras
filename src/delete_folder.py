"""Permanently delete selected files/folders without traversing symlink parents."""
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys


def validate_path(value, root=Path('/content')):
    # root is injectable only for disposable local tests, never a CLI argument.
    path = Path(value)
    if not path.is_absolute() or any(ord(c) < 32 or ord(c) == 127 for c in str(value)) or any(p in ('.', '..') for p in str(value).split('/')):
        raise ValueError('Choose an absolute file or folder inside /content.')
    try:
        parts = path.relative_to(root).parts
    except ValueError:
        raise ValueError('Only files and folders inside /content can be deleted.')
    if not parts or any(p.startswith('.colab-folder-zip-') for p in parts):
        raise ValueError('Runtime roots and job folders cannot be deleted.')
    if parts[0] == 'drive' and (len(parts) == 1 or
            (parts[1] == 'MyDrive' and len(parts) == 2) or
            (parts[1] == 'Shareddrives' and len(parts) <= 3)):
        raise ValueError('Drive roots cannot be deleted.')
    return path, parts


def remove_folder(value, root=Path('/content'), report=lambda **data: None):
    return remove_item(value, True, root, report)


def runtime_mounts():
    # Colab uses Linux overlayfs: regular files can have a different st_dev
    # from their parent without being mounts. Use the kernel mount table,
    # which also identifies same-device bind mounts that ismount() misses.
    if not sys.platform.startswith('linux'):
        return None
    mounts = set()
    try:
        with open('/proc/self/mountinfo', encoding='utf-8', errors='surrogateescape') as source:
            for line in source:
                header, separator, filesystem = line.partition(' - ')
                fields = header.split()
                if not separator or len(fields) < 6 or len(filesystem.split()) < 3:
                    raise ValueError('Invalid mount table.')
                point = re.sub(r'\\(040|011|012|134)',
                               lambda match: chr(int(match[1], 8)), fields[4])
                if not point.startswith('/'):
                    raise ValueError('Invalid mount path.')
                mounts.add(Path(point))
        if not mounts:
            raise ValueError('Empty mount table.')
    except (OSError, ValueError) as error:
        raise RuntimeError('Cannot inspect runtime mounts. Nothing was deleted.') from error
    return mounts


def remove_item(value, is_directory, root=Path('/content'), report=lambda **data: None):
    path, parts = validate_path(value, root)
    if is_directory and not getattr(shutil.rmtree, 'avoids_symlink_attacks', False):
        raise RuntimeError('This runtime cannot safely delete folders without following links.')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    previous = os.open('.', flags)
    parent = None
    deleting = False
    try:
        # Pin each parent directory without resolving symlink aliases. Changing
        # cwd is confined to this dedicated process; no notebook cwd is changed.
        parent = os.open(root, flags)
        for component in parts[:-1]:
            child = os.open(component, flags, dir_fd=parent)
            os.close(parent)
            parent = child
        os.fchdir(parent)
        name = parts[-1]
        before = os.stat(name, follow_symlinks=False)
        if not (stat.S_ISDIR(before.st_mode) if is_directory else stat.S_ISREG(before.st_mode)):
            raise ValueError('The selected item changed type or is a symbolic link/special file. Refresh Files before retrying.')
        report(state='checking')
        mounts = runtime_mounts()
        # cwd is the pinned, physical parent, including on local systems where
        # /var aliases /private/var. Compare whole paths, never name prefixes.
        physical_path = Path.cwd() / name
        mount_error = ('A mounted directory cannot be deleted. Choose a folder inside it.'
                       if is_directory else 'A mounted file cannot be deleted.')
        if mounts is not None and any(mount == physical_path or
                (is_directory and physical_path in mount.parents) for mount in mounts):
            raise ValueError(mount_error)
        # Refuse mounted trees before deleting any contents. fwalk pins
        # directories and never traverses symlinks; retain its device check
        # for directory mounts appearing after the mount-table snapshot.
        def walk_error(error):
            raise error
        if is_directory:
            for current, dirs, files, fd in os.fwalk(name, follow_symlinks=False, onerror=walk_error):
                if ((mounts is None and os.path.ismount(current)) or
                        os.fstat(fd).st_dev != before.st_dev):
                    raise ValueError(mount_error)
        elif mounts is None and os.path.ismount(name):
            raise ValueError(mount_error)
        now = os.stat(name, follow_symlinks=False)
        if (before.st_dev, before.st_ino) != (now.st_dev, now.st_ino):
            raise RuntimeError('The selected item changed. Nothing was deleted.')
        report(state='deleting')
        deleting = True
        if is_directory:
            shutil.rmtree(name)
        else:
            os.unlink(name)
        if os.path.lexists(name):
            raise RuntimeError('The item still exists or was recreated by another process.')
        report(state='deleted', path=str(path))
    except Exception as error:
        report(state='error', error=str(error), partial=deleting)
        raise
    finally:
        os.fchdir(previous)
        os.close(previous)
        if parent is not None:
            os.close(parent)


def deletion_plan(items, root=Path('/content')):
    # Validate the entire request before deleting anything. Collapse parent/
    # child selections so a selected tree is only processed once.
    if not isinstance(items, list) or not items:
        raise ValueError('Select at least one file or folder.')
    unique = {}
    for item in items:
        if (not isinstance(item, dict) or not isinstance(item.get('path'), str)
                or type(item.get('isDirectory')) is not bool):
            raise ValueError('Invalid deletion selection.')
        path = str(validate_path(item['path'], root)[0])
        if path in unique and unique[path]['isDirectory'] != item['isDirectory']:
            raise ValueError('Conflicting file types in selection.')
        unique[path] = dict(path=path, isDirectory=item['isDirectory'])
    directories = {path for path, item in unique.items() if item['isDirectory']}
    return [item for path, item in unique.items()
            if not any(str(parent) in directories for parent in Path(path).parents)]


def remove_selected(items, root=Path('/content'), report=lambda **data: None):
    plan = deletion_plan(items, root)
    results = []
    def progress(**data):
        report(state='deleting', total=len(plan), completed=len(results),
               current=item['path'], phase=data['state'], results=list(results))
    for item in plan:
        last = {}
        def item_report(**data):
            last.update(data)
            progress(**data)
        try:
            remove_item(item['path'], item['isDirectory'], root, item_report)
            results.append(dict(path=item['path'], deleted=True))
        except Exception as error:
            results.append(dict(path=item['path'], deleted=False, error=str(error),
                                partial=bool(last.get('partial', False))))
        report(state='deleting', total=len(plan), completed=len(results),
               current=item['path'], results=list(results))
    report(state='complete', total=len(plan), completed=len(results), results=results)
    return results


def main():
    batch = len(sys.argv) > 1 and sys.argv[1] == '--batch'
    source, job = sys.argv[2:] if batch else sys.argv[1:]
    job = Path(job).absolute()
    def report(**data):
        temporary = job / 'status.tmp'
        temporary.write_text(json.dumps(data), encoding='utf-8')
        os.replace(temporary, job / 'status.json')
    try:
        if batch:
            results = remove_selected(json.loads(Path(source).read_text(encoding='utf-8')), report=report)
            return 0 if all(item['deleted'] for item in results) else 1
        remove_folder(source, report=report)
    except Exception as error:
        if not (job / 'status.json').exists():
            report(state='error', error=str(error), partial=False)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
