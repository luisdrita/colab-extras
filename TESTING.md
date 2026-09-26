# Verification record

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
