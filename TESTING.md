# Version 0.9.5 — 20 October 2026

- The mirrored Undo arrow rotates counterclockwise throughout a toolbar Undo, including recovery and the final sidebar refresh. Repeated clicks remain disabled. Success and failure both clear the busy state; successful completion stays silent and empty history returns to grey. Reduced-motion preferences disable the animation.
- All 67 JavaScript tests pass. Python workers are unchanged from their 93 passing tests on 0.9.2 and were not rerun for this presentation change.
- Chrome checks with the exact generated bundle in the simulated-Colab harness confirmed the held Undo keeps its animation and changing rotation matrix, busy state, and disabled click state. Successful completion removed the animation and feedback, restored the mirrored resting transform, and greyed the empty-history button. A simulated recovery failure also stopped rotation and retained the error and available action.
- Build reproducibility, JavaScript syntax, ZIP integrity, and packaged-file equality passed. This browser simulation does not establish the installed hosted Colab behavior; reload the extension and refresh Colab to activate the update. Chrome Store submission remains blocked by dashboard access.

---

# Version 0.9.4 — 20 October 2026

- Successful and cleanly cancelled operations remove their loading circle immediately, leaving no completion text or status badge. Sidebar refreshes do not restore completed badges. Successful Undo is silent; failures and recovery conflicts remain visible.
- Folder-details results still show the requested statistics, but the completed scan has no status label.
- All 67 JavaScript tests pass. Python workers are unchanged from their 93 passing tests on 0.9.2 and were not rerun for this presentation-only change.
- Chrome checks using the exact generated bundle in the simulated-Colab harness verified a completed ZIP leaves zero status badges, refreshing file rows does not restore them, completed folder statistics remain visible with an empty hidden status, and successful Undo leaves no feedback element and a disabled empty-history button.
- Build reproducibility, JavaScript syntax, and ZIP integrity/content equality passed. The installed extension requires a manual reload and Colab refresh; these browser checks do not establish hosted-runtime behavior. Chrome Store dashboard access remains blocked and no Store publication is claimed.

---

# Version 0.9.3 — 20 October 2026

- Running operation badges display only the existing Material-style loading circle. Action labels and percentages are hidden visually while the progress indicator retains its accessible label and tooltip. Final results and errors remain visible. The folder-details scan also hides its running status text until it finishes.
- All 67 JavaScript tests pass. Python workers are unchanged from the 93 passing tests on 0.9.2; they were not rerun for this presentation-only change.
- Chrome checks with the exact generated bundle in the simulated-Colab harness verified determinate and indeterminate ZIP progress with no visible label, preservation after file-row replacement, visible ZIP completion, circle-only folder scanning, accessible scan details, and visible cancellation feedback.
- Build reproducibility, JavaScript syntax, and ZIP integrity/content equality passed. Installed hosted Colab needs a manual reload; Chrome Store dashboard access remains blocked and no Store publication is claimed.

---

# Version 0.9.2 — 20 October 2026

- Removed the history dialog and Undo-related context-menu commands. Move/Copy remain ordinary file commands; native Colab rename/new-folder controls are retained. Preferences moved to the extension popup and stay reversible through the toolbar button.
- Empty Undo history now gives a grey, disabled icon with a Nothing to undo tooltip. History is loaded when a runtime connects and refreshed after tracked file mutations; local UI Undo uses the known history without creating a terminal per folder click.
- Trusted folder-row openings and closings are tracked individually. Undo restores collapsed/expanded state and expanded descendants, resolves replacement rows by path, and retains an action if its folder is no longer available. Programmatic refreshes and Undo itself are not recorded as new folder actions.
- 67 JavaScript tests pass; the unchanged Python recovery workers retain their 93 passing tests. Added checks cover button availability, nested restoration, reverse action order, row replacement, missing folders, capture/target event timing, and popup-only preference messaging.
- Chrome checks with the exact generated bundle in the simulated-Colab harness confirmed folder open Undo, folder close Undo with a previously expanded child, sequential local Undo, and the absence of recovery commands in the menu. The final build showed a grey, disabled button after the last action, enabled it after opening a folder, and disabled it again after Undo. The open context menu had only ordinary file actions and no recovery/history commands. No Undo dialog appeared. Hosted Colab 0.9.2 and the popup-to-installed-tab integration require a manual extension reload and are not claimed as live-verified.
- Chrome Store automation remains blocked; no Store publication is claimed. Earlier hosted-runtime and optional-download limitations below still apply.

---

# Version 0.9.1 — 20 October 2026

- The toolbar Undo arrow now reverses exactly the newest supported action without opening a dialog. File recovery, sidebar navigation, and extension settings share chronological selection; runtime timestamps are normalized to the browser clock.
- Conflicts remain on the latest action instead of falling through to older actions. Empty history and errors use a nonmodal sidebar status. Duplicate clicks during recovery are ignored.
- Selective recovery and settings moved to **History and settings…** in file/folder context menus.
- 93 Python tests and 54 JavaScript tests pass. Ten new tests cover ordering, clock differences, conflicts, empty history, lookup failure, rapid clicks, and the toolbar binding.
- Chrome browser checks against the exact generated bundle in the simulated-Colab harness passed: a single toolbar click undid the newest ZIP action, a second click reported empty history, navigation returned to `/content`, and a setting change was restored. Each direct Undo had zero open dialogs. The separate History and settings menu remained usable, and reopening it confirmed the setting was restored.
- The installed unpacked folders were updated in place. Chrome must reload the extension and refresh Colab to run 0.9.1 there. The hosted runtime checks listed for 0.9.0 remain historical evidence for the unchanged recovery operations; they do not establish the new toolbar interaction in hosted Colab.
- Chrome Web Store submission and optional managed-download integration remain subject to the limits recorded below.

---

# Version 0.9.0 — 20 October 2026

## Completed verification

- 93 Python tests pass. New recovery tests cover deleted trees and metadata, generated ZIP identity/hash checks, extraction and overwrite restoration, cancellation after an extracted file, later edits, replaced files, occupied destinations, symlink parents, native rename/move/copy, cross-filesystem move fallback, new folders, binary uploads, and chunked replacement.
- 44 JavaScript tests pass. New checks cover native mutation interception, internal-request bypass, Colab's complete upload-call boundary, explicit final chunk handling, upload cancellation, empty uploads, runtime reconnection, sidebar navigation, protected paths, optional download permissions, tracked download associations, and rejecting webpage/untracked local-file deletion requests.
- Generated JavaScript syntax, Python 3.8 grammar, manifest shape, ZIP integrity, and packaged-file equality are checked.
- The exact generated bundle was exercised in the local browser harness for the backwards-arrow toolbar control, history listing, undo result, previous sidebar location, settings reversal, and dark theme. The harness connection and file results are simulated; Python worker tests use disposable local fixtures.
- Colab's public frontend source currently served at build `7a710b5d9351e60bafbe4ea199eb8f8f` was inspected to verify `files.rootPath`, the shared kernel XHR, and the full `files.write` call. Its upload implementation sends numbered chunks without a final -1 marker, so the extension wraps the full write call and supplies an explicit completion boundary to its worker.

## Live installed-extension verification

Version 0.9.0 was manually installed in Chrome and exercised on a hosted Colab Pro+ CPU runtime on 20 October 2026 using a disposable notebook and synthetic fixtures.

- The backwards-arrow button appeared beside Refresh and loaded the runtime recovery history.
- Native upload, file rename, folder creation, and replacement were recorded and undone. A freshly reopened file preview confirmed exact restoration of the original contents after replacement.
- ZIP only selected a numbered destination without replacing the uploaded source ZIP; Undo removed the generated archive while retaining the source.
- Extraction created nested files and an empty directory. Undo removed those outputs and retained the archive. Opt-in overwrite extraction restored the retained original.
- After editing an overwritten file, selective extraction Undo preserved that later edit, reported its conflict, and removed only the unchanged new file. Reversing the later saves and retrying recovery restored the original exact contents.
- Extension copy created a numbered tree, move changed its full path, and recoverable deletion retained it. Undo restored the deleted tree, reversed the move, and removed the unchanged copy in sequence.
- Native folder Open followed by Previous sidebar location returned to `/content`. A preference change was reversed through Undo. The test-only overwrite preference was restored to off; the user's requested download tracking remains enabled.

Colab can retain stale file previews after external filesystem changes; content verification above used closed and freshly reopened previews.

The live cancellation check exposed a stale Cancel action during post-completion cleanup. The final build removes that action as soon as the result is finished and ignores stale clicks. It also cleans staging after cancellation before the ZIP worker starts. Both boundaries have regression tests. After the user reloaded the final build, two startup-cancellation checks left no new archive in the refreshed sidebar or ready action in history. Completed actions no longer offered Cancel. Mid-operation rollback at all timing points remains covered only by the applicable automated tests.

## Publication and remaining validation

The Chrome Web Store developer dashboard returned `Not allowed` during this session. No package upload, review submission, or Store publication has been confirmed for 0.9.0. GitHub publication is tracked separately.

Optional managed-download integration is pending: attempts before and after reload reported missing Chrome permission, retained the runtime ZIP, and kept it available in Undo. The user had reported enabling permission, so the exact active extension copy and grant still need confirmation. Successful managed downloads and completed local-copy removal are not claimed as live-verified.

Mounted Drive, free-tier/local/enterprise runtimes, large datasets, and mid-operation cancellation are not claimed as live-verified. Applicable automated tests cover cancellation and recovery boundaries; those results do not establish every live platform or timing case.

## Live smoke test

Use a disposable notebook/runtime. Confirm the extension marker says 0.9.0 and only one Colab Extras copy is enabled. Test the mirrored Refresh icon; native new folder and rename; upload and replacement; ZIP plus Undo; extraction plus Undo; opt-in replacement extraction; recoverable folder deletion; copy/move plus Undo; navigation back; settings undo; and preservation of a file changed after an operation. Verify the original notebook cell count and execution state remain unchanged. Grant optional downloads permission manually if testing that feature, then verify the popup manages only its own tracked download.

---

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
