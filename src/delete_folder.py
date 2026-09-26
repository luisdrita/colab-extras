"""Delete one confirmed folder, using Python's symlink-resistant tree removal."""
import json
import os
from pathlib import Path
import shutil
import stat
import sys


def validate_path(value, root=Path('/content')):
    # root is injectable only for disposable local tests, never a CLI argument.
    path = Path(value)
    if not path.is_absolute() or any(ord(c) < 32 or ord(c) == 127 for c in str(value)) or any(p in ('.', '..') for p in str(value).split('/')):
        raise ValueError('Choose an absolute folder inside /content.')
    try:
        parts = path.relative_to(root).parts
    except ValueError:
        raise ValueError('Only folders inside /content can be deleted.')
    if not parts or any(p.startswith('.colab-folder-zip-') for p in parts):
        raise ValueError('Runtime roots and job folders cannot be deleted.')
    if parts[0] == 'drive' and (len(parts) == 1 or
            (parts[1] == 'MyDrive' and len(parts) == 2) or
            (parts[1] == 'Shareddrives' and len(parts) <= 3)):
        raise ValueError('Drive roots cannot be deleted.')
    return path, parts


def remove_folder(value, root=Path('/content'), report=lambda **data: None):
    path, parts = validate_path(value, root)
    if not getattr(shutil.rmtree, 'avoids_symlink_attacks', False):
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
        if not stat.S_ISDIR(before.st_mode):
            raise ValueError('Choose a regular folder, not a file or symbolic link.')
        # Refuse a selected mount or a tree containing mounted directories.
        # fwalk uses directory descriptors and never traverses symlinks.
        report(state='checking')
        def walk_error(error):
            raise error
        for current, dirs, files, fd in os.fwalk(name, follow_symlinks=False, onerror=walk_error):
            if os.path.ismount(current) or os.fstat(fd).st_dev != before.st_dev:
                raise ValueError('A mounted directory cannot be deleted. Choose a folder inside it.')
        now = os.stat(name, follow_symlinks=False)
        if (before.st_dev, before.st_ino) != (now.st_dev, now.st_ino):
            raise RuntimeError('The selected folder changed. Nothing was deleted.')
        report(state='deleting')
        deleting = True
        shutil.rmtree(name)
        if os.path.lexists(name):
            raise RuntimeError('The folder still exists or was recreated by another process.')
        report(state='deleted', path=str(path))
    except Exception as error:
        report(state='error', error=str(error), partial=deleting)
        raise
    finally:
        os.fchdir(previous)
        os.close(previous)
        if parent is not None:
            os.close(parent)


def main():
    source, job = sys.argv[1:]
    job = Path(job).absolute()
    def report(**data):
        temporary = job / 'status.tmp'
        temporary.write_text(json.dumps(data), encoding='utf-8')
        os.replace(temporary, job / 'status.json')
    try:
        remove_folder(source, report=report)
    except Exception as error:
        if not (job / 'status.json').exists():
            report(state='error', error=str(error), partial=False)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
