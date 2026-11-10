<p align="center"><img src="extension/icons/icon-128.png" width="96" height="96" alt="Colab Extras icon"></p>

# Colab Extras

File tools for Google Colab. Inspect folders, create and download ZIPs, extract archives, and bulk-delete selected files and folders from the Files sidebar.

**Version 0.10.14 · Chrome 120+ · Independent extension, not affiliated with Google.**

Version 0.10.14 adds **Back to /content**, which returns directly to the session folder when browsing elsewhere. It also includes Command/Ctrl selection with bulk deletion, recursive folder deletion, numbered extraction copies, automatic ZIP downloads, and simpler Folder details. Undo, Move and Copy have been removed. Progress circles appear to the right of affected names, and successful operations finish quietly.

Download the [0.10.14 release](https://github.com/luisdrita/colab-extras/releases/tag/v0.10.14). The Chrome Web Store upload is still pending because automated access to the developer dashboard is blocked. See [verification status](TESTING.md) for coverage and live-check limits.

## File tools

Right-click a folder for **Folder details**, **ZIP only**, **ZIP and download**, or **Delete folder**. The normal folder Delete entry removes that folder and its entire contents, including nested and hidden items. If Colab does not expose a recognized Delete entry, **Delete folder and contents** remains available as a fallback. Folder details shows total file size, file and subfolder counts, and the largest files. Right-click a supported archive for **Extract here**. Native Colab upload, rename, new-folder, and navigation controls operate normally. The extension reads the current Files location only to show the return shortcut; it does not retain navigation history.

ZIPs are saved beside the source folder with a numbered name if necessary. The loading circle disappears after success; errors remain visible. Cancellation during compression removes incomplete output; cancelling a download after ZIP creation leaves the saved runtime archive in place.

Hold **Command (⌘) on Mac** or **Ctrl on Windows/Linux** while clicking file and folder rows to add or remove them from the selection. Selected rows are slightly highlighted using Colab’s theme. A normal click selects just that row and keeps Colab’s ordinary opening/expanding behavior. Right-click a selected row and choose **Delete selected items (N)** in the existing Delete menu position. Left-clicking blank space outside the selected rows clears the selection, including the sidebar, space inside an expanded folder, and the rest of the page. A normal left-click on another row selects that item instead. Right-clicking blank space preserves the selection; right-clicking another row switches the context to that item. Right-clicking a selected row, including its icons or menu button, preserves the group and shows only supported batch actions. Currently this is **Delete selected items**. Single-item commands such as Open, Rename, ZIP, and Extract are hidden for a group and restored for a single item. Press **Escape** on a focused file row to clear selection; **Delete** (or **Command-Backspace** on Mac) starts deletion immediately, without a confirmation box. Native rename inputs, expansion arrows, and action buttons keep their usual behavior. Selections survive automatic file-list refreshes and are reset when the runtime changes. A selected folder includes its entire contents. Command/Ctrl-clicking a child replaces any selected ancestor, so opening a folder and then selecting items inside it does not include the enclosing folder in deletion. Explicitly selecting a folder replaces selected descendants with that folder. Unrelated selections are preserved. Loading circles appear to the right of the names of all selected rows and visible affected descendants, including queued items. New or refreshed affected rows regain their circles while still pending. Each circle disappears when its containing deletion target succeeds or fails, and successful completion shows no message box. Clearing the selection does not change the running operation. Successful items are removed from the selection, while failures show a path-specific error and remain selected unless you explicitly cleared the selection. A connection loss reports uncertain results without automatically retrying deletion.

Extension runtime file and folder deletion starts immediately and is permanent: contents are not retained or moved to Trash. Runtime roots, Drive roots, symbolic-link parents, and staging folders are protected.

## Extraction

Right-click a ZIP, TAR, TAR.GZ, or TGZ and choose **Extract here**. Files are extracted beside the archive, which is retained. Existing files and folders are preserved by default. If `sample_data` already exists, extraction creates a separate `sample_data (1)` folder, then `(2)`, and so on. The complete folder tree stays together, including nested and empty folders. Loose files receive a numbered name before the extension, such as `report (1).csv`. The **Chrome extension popup** can explicitly enable replacement of existing files instead of numbered copies. Successful replacement is permanent; temporary originals are removed after completion.

Archive traversal paths, links, special files, encrypted ZIPs, sparse TAR entries, and archives over 100,000 entries are rejected. Executable permissions and ownership are not inherited from archives. Failed or cancelled extraction attempts rollback of that running operation, preserving subsequent changes. If rollback encounters a conflict, the error lists temporary originals that remain for manual inspection. There is no completed-operation Undo.

## Automatic downloads

**ZIP and download** is always active: selecting it creates the ZIP and starts the download as soon as the archive is ready. No popup setting is required. Downloads start before sidebar refresh and terminal cleanup. **ZIP only** continues to save the archive without downloading it.

Without optional download permission, the extension uses Colab's normal download. If permission has already been granted, downloads are automatically tracked and request no Save As dialog. The old tracking toggle is ignored. An unavailable tracking helper falls back to normal download; an uncertain response after a download was dispatched is not retried, to avoid duplicate files.

The popup's optional tracking button enables cancellation and local-copy management for future tracked downloads. Cancelling a tracked download or deleting its completed local copy does not remove the runtime ZIP. Other downloads and copies outside the browser are unaffected. Large browser downloads may require substantial memory.

## Temporary storage and upgrades

Worker scripts and status files use temporary `.colab-folder-zip-*` directories. Extraction uses private temporary staging only for the running operation and cleans it after success. Interrupted operations or rollback conflicts can leave temporary files.

The extension no longer creates a persistent recovery journal or retains completed-operation backups. Recovery data left by older versions is not automatically deleted during upgrade, so existing user files are preserved.

## Install and develop

Load the `extension/` directory as an unpacked extension in Chrome Developer mode. Disable other copies while testing, then refresh Colab. A connected hosted runtime with Python 3.8+ and independent Jupyter terminal access is required. Unsupported terminal access fails without executing a notebook cell. Runtime CPU, memory, and disk are used by the operations.

No npm dependencies are needed. Build and test with:

```sh
python3 build.py
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.cjs
node --check extension/colab-zip.js
```

`extension/colab-zip.js` is generated from `src/`. For the simulated browser harness, serve the repository with `python3 -m http.server 8765 --bind 127.0.0.1`, then open `http://127.0.0.1:8765/tests/ui.html`. This is a simulated runtime, not live Colab validation.

## Privacy and feedback

No analytics, ads, developer-operated file service, or extension account. File contents and temporary operation data stay in the user's browser, runtime, and selected mounted filesystem. Read the [privacy policy](PRIVACY.md).

[Report an issue](https://github.com/luisdrita/colab-extras/issues) with the version, action, runtime type, and error. Remove confidential paths, file contents, and credentials before posting.
