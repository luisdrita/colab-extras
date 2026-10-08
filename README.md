<p align="center"><img src="extension/icons/icon-128.png" width="96" height="96" alt="Colab Extras icon"></p>

# Colab Extras

File and folder tools integrated into Google Colab's design and workflow. Colab Extras extends the Files sidebar with familiar right-click menus, dialogs that follow Colab's light and dark themes, and circular progress indicators. Right-click a folder to inspect it, ZIP it, download it, or delete it after confirmation. Right-click a supported archive to extract its contents beside it.

**Version 0.8.0 · Chrome 120+ · Independent extension, not affiliated with Google.**

| Action | What it does |
| --- | --- |
| Folder details | Shows total file size, file and subfolder counts, symbolic links, and the 10 largest files. |
| ZIP only | Saves a ZIP beside the selected folder, preserving existing archives with numbered filenames. |
| ZIP and download | Creates the ZIP and starts its download. |
| Extract here | Unpacks ZIP, TAR, TAR.GZ, or TGZ files into the archive’s current directory, keeping the archive and preserving existing files. |
| Delete folder and contents | Permanently removes the selected folder after confirming its exact path. |

ZIP actions start immediately. A Colab-style loading circle appears beside the folder during scanning, compression, saving, downloading, and deletion. It shows percentage progress when available, follows the page theme, and disappears on completion, cancellation, or failure. Right-click again to cancel an active ZIP. Folder details also shows a loading circle while scanning.

![Folder details dialog with labelled example data](docs/folder-details.png)

## Install in Chrome

The published extension is available in the [Chrome Web Store](https://chromewebstore.google.com/detail/colab-extras/aeghdoedemnfdoagpopjdbopnlphaaad). Download version 0.8.0 for local installation from [GitHub Releases](https://github.com/luisdrita/colab-extras/releases/tag/v0.8.0). Chrome Web Store submission and approval are separate; the Store can offer an earlier version.

To test this build locally:

1. Use the supplied unpacked `colab-extras-0.8.0` folder, or extract the supplied version 0.8.0 ZIP into a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`, or drag that entire folder onto the Extensions page.
4. Refresh Colab, connect a compatible hosted runtime, and open the **Files** sidebar.
5. Right-click an archive and choose **Extract here**, or right-click a folder for the existing actions.

If you clone this repository, load its `extension/` folder instead. After updating, reload the extension in Chrome and refresh your Colab tab. Do not enable duplicate copies.

## Runtime requirements

Requires Chrome 120+, a connected hosted Colab runtime with Python 3.8+, and access to independent Jupyter terminals. Terminal availability may depend on your Colab plan and runtime configuration. Free-tier compatibility has not been verified.

Operations run in a separate process on the **same Colab virtual machine**. They use its CPU, memory, and disk, without adding or queueing a notebook cell. Compression finishes before the archive is downloaded. No setup cell, API key, external compression service, or extension account is required.

Keep the Colab tab and runtime connected. ZIP creation needs sufficient free space and a writable parent folder. Colab may buffer a downloaded archive in the browser; multi-gigabyte downloads have not been validated. Files changing during an operation can cause errors or inconsistent results; this is not a filesystem snapshot. Unsupported terminal access produces an error without running a notebook cell.

## Extract here

Right-click a `.zip`, `.tar`, `.tar.gz`, or `.tgz` file in the Files sidebar and choose **Extract here**. Contents are written into the directory containing the archive, preserving the archive's internal folders. No extra enclosing folder or destination picker is added. The original archive is kept.

The complete member list and existing paths are checked before extraction. Existing directories may be reused, but if any file would be overwritten, extraction stops before writing anything. Rename or move the conflicting file yourself before retrying. The extension rejects absolute/traversal paths, symbolic links, hard links, device files, sparse TAR entries, encrypted ZIP files, and archives with more than 100,000 entries. Extraction does not restore executable bits or ownership from an archive.

Progress appears beside the archive; right-click again for **Cancel extraction**. An interrupted or corrupt archive can leave successfully extracted files and created directories. The incomplete file being written is removed when the worker can handle the error. Errors explain when partial contents may remain. Runtime loss can prevent cleanup, so inspect Files before retrying. Extraction requires a writable destination, enough free space, and a regular archive under `/content` (including mounted Drive folders); paths through symbolic-link parents are rejected.

## Deletion and scanning

**Deletion is permanent and bypasses Trash, including on mounted drives. There is no undo.** Use it only after checking the confirmed path. Deletion cannot be cancelled after confirmation and may be partial if permissions or connectivity fail.

Deletion is limited to subfolders of `/content`. Runtime roots, standard Drive roots, mount points, staging folders, and paths reached through symbolic-link parents are protected. Symbolic links inside the selected folder are removed as links, without deleting their targets. Stop other processes writing to a folder before deleting it.

Folder details reads metadata, includes hidden files and empty folders, and counts symbolic links without traversing their targets. Size means logical regular-file bytes, not allocated disk space; hard-linked paths count separately. Special files and extension staging folders are excluded. Unreadable or changing entries are reported as incomplete totals.

Version 0.8.0 ZIP extraction and existing-file conflict handling have been checked through the installed extension on a hosted Colab Pro+ CPU runtime. Mounted-Drive operations, free-tier runtimes, and other archive formats still need live verification. Colab's internal page and terminal interfaces can change. See [Testing](TESTING.md) for the verified scope.

## Privacy

The extension runs only on `https://colab.research.google.com/*` and uses Colab's existing authenticated runtime connection. It has no ads, analytics, telemetry, credential store, or developer-operated file service. Files and operation data are not sent to the developer. Completed jobs clean up their staging files when possible; disconnections can leave temporary files. ZIPs and downloads remain until you remove them.

Read the [privacy policy](PRIVACY.md). A copy is included in the extension popup.

## Develop and test

No npm packages are required. Use Python 3.8+ and Node.js 20+:

```sh
python3 build.py
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.cjs
node --check extension/colab-zip.js
```

`extension/colab-zip.js` is generated from the readable JavaScript and bundled Python in `src/`. Rebuild it after changing source files.

For the local browser harness, run `python3 -m http.server 8765 --bind 127.0.0.1` from the repository root, then open `http://127.0.0.1:8765/tests/ui.html`. Its connection and file data are simulated; it does not operate on a real Colab runtime.

## Feedback

[Open an issue](https://github.com/luisdrita/colab-extras/issues) with the extension version, Colab runtime type, action, and error message. Remove private paths, notebook contents, credentials, and other confidential data before posting.
