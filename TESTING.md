# Version 0.8.0 verification — 8 October 2026

- 60 Python tests pass, including 22 extraction tests covering ZIP/TAR/TAR.GZ/TGZ, nested/Unicode/hidden/empty files, preserving the source archive, existing-file conflicts, directory merging, traversal, links, special files, cancellation, corrupt ZIP data, insufficient space and a concurrent file-creation race.
- 24 JavaScript tests pass, including archive recognition, extraction destination locking, validated results, worker startup, terminal failure, partial results, cancellation, late cancellation and staging cleanup.
- Generated bundle passes `node --check`; Python sources parse with Python 3.8 grammar; manifest version and permission scope checked. No new extension permissions.
- Chrome local simulator: ZIP extraction completes; TAR.GZ displays progress; dark theme works; replacing sidebar rows preserves the active progress indicator; cancellation removes progress; conflicts display persistent feedback; ordinary files do not get archive actions; existing folder menus remain available.
- Live hosted Colab Pro+ CPU runtime: confirmed the installed extension's version marker is 0.8.0, uploaded a disposable ZIP, used Extract here from its Files menu, and verified the text file's exact contents, a nested CSV entry, an empty directory, and the retained source ZIP. The notebook's existing empty cell remained unexecuted and no cells were added. A conflicting archive was rejected with "Already exists; nothing was overwritten".
- TAR/TAR.GZ/TGZ, mounted Drive, free-tier runtimes, large archives, and cancellation remain covered only by the applicable local tests/simulator, not this live smoke test.
- Initial extension loading required a manual step. GitHub release availability and Chrome Web Store review status are tracked separately from these test results.

## Source recovery

The older checkout in the 26 September workspace was offloaded to iCloud and could not be read. This local checkout starts from the public repository and restores the recorded final v0.7.0 progress changes before adding extraction. The recovered progress and details files match the recorded local byte sizes (2627 and 11080 respectively). The old checkout was not overwritten.

## Commands

```sh
python3 build.py
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.cjs
node --check extension/colab-zip.js
```

## Earlier verification history

# Verification record

## Version 0.7.0 — circular folder progress

Added an 18-pixel Material-style loading circle for ZIP preparation, compression, saving, downloading, metadata scans, and confirmed deletion. Available percentages render as a determinate ring; unknown progress and cancellation animate without a fabricated percentage. The indicator inherits Colab's theme colour and supports reduced-motion preferences. Folder details uses the same indicator during a scan.

Active indicators survive replacement of the Files sidebar rows, including while a download is waiting without new callbacks. Completed, cancelled, and failed jobs remove the circle while retaining their existing text feedback. Parent and child folder badges are scoped to their own rows.

On 28 September 2026, all **53 automated tests passed** (38 Python and 15 JavaScript). Browser checks against the actual generated bundle in the simulated-Colab harness verified: indeterminate startup; 65% saving and 40% download rings with accessible values; light/dark colours; row replacement while saving and while a download is held; ZIP cancellation; scan cancellation; exactly one completed download; confirmed simulated deletion; and removal of the ring on a deletion error. The folder-operation backends and permissions are unchanged.

The original unpacked installation directory is updated in place. Chrome must reload it and refresh Colab before this version runs there. These checks do not claim that the installed extension was reloaded or that the Store listing was updated.

## Version 0.6.2 — initial public repository

Version 0.6.2 adds a bundled privacy policy and popup link. Folder-action logic is unchanged from 0.6.1; all six source files were compared and only the version marker differs. The Store ZIP contains the manifest at its root, and its files match `extension/`.

## Automated checks

On 26 September 2026, all **53 tests passed** from this repository: 38 Python tests and 15 JavaScript tests. The generated bundle passed its syntax check, a rebuild produced identical bytes, and the downloadable ZIP matched every file in `extension/`.

The suite contains 38 Python tests and 15 JavaScript tests. It covers nested and empty archives, hidden and Unicode names, filename collisions, symlinks, changing files, cancellation, protected deletion roots, deletion failures and replacement races, metadata-only scanning, largest-file ordering, incomplete totals, result validation, and overlapping-operation guards.

The generated bundle also receives a syntax check and a rebuild comparison. Python tests operate on temporary local fixtures, not user folders or the Colab VM.

## Browser verification

The local simulated-Colab harness has been used to verify immediate ZIP actions, exactly one download request, menu-blur handling, cancellation, confirmed deletion, protected roots, folder-details states, light/dark appearance, scrolling, keyboard dismissal, focus restoration, and literal rendering of HTML-looking filenames under Trusted Types enforcement.

The bundled privacy page opens from the new popup link. The public screenshot shows the actual dialog with simulated data, explicitly labelled as example data.

## Live verification limits

The original terminal backend was tested on a real hosted Colab VM while the notebook kernel was busy. The latest installed extension still requires a manual reload and a fresh live check. Free-tier terminals, mounted-Drive operations, local/enterprise runtimes, and multi-gigabyte downloads are not validated.

Before a Store submission, reload the extension, refresh a disposable Colab notebook, connect a compatible runtime, and check Folder details, ZIP only, ZIP and download, and deletion of a disposable folder containing a test file. Do not test deletion on user data. Confirm that notebook cells are not added or queued.
