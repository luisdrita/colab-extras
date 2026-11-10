# Version 0.10.14 — 10 November 2026

- Added Back to /content in the Files pane's parent-navigation area when browsing outside /content. It returns directly to the session folder and hides inside /content and its descendants. Native parent navigation is preserved. The shortcut follows Colab's theme, supports mouse and keyboard activation, clears stale selection, and disables duplicate clicks while refreshing. Failures appear inline and can be retried; stale callbacks cannot change a replacement runtime/tree or overwrite a newer navigation.
- Read-only inspection of the connected hosted Colab confirmed the parent-link container, currentTree.files.rootPath and native parent-row refresh behavior. Navigation uses those existing APIs without executing notebook cells, changing the Python working directory, or retaining navigation history. No runtime files were changed.
- All 61 JavaScript tests and all 35 existing isolated Chrome selection/deletion check groups pass. Seven additional browser check groups cover visibility, parent navigation, mouse/keyboard return, selection clearing, delayed refresh, duplicate activation, failure/retry, tree/runtime replacement, superseding navigation, rerendering and disconnection. No dialogs or page errors occurred. Inspected dark and narrow screenshots; light capture is also available. Windows Ctrl semantics are emulated on macOS, not native Windows.
- All five Python workers are byte-identical to 0.10.13; the latest backend suite remains the 91 passing tests from 0.10.12. Python tests were not rerun for this navigation-only change. Reproducible build, generated JavaScript syntax, diff whitespace, ZIP integrity and package/install byte comparisons passed. No additional permissions.
- Updated the existing unpacked installation to 0.10.14. Reload Colab Extras in Chrome's Extensions page and refresh Colab to activate. New shortcut activation in hosted Colab has not been verified; interaction tests use an isolated browser fixture matching the inspected native navigation API. The GitHub release packages the exact verified ZIP (SHA256 `07bc4f73ad4e413c32bade3a330dcc7e704cf5b070c66369a921a5efaa93f30d`). Chrome Web Store upload was not completed: on 10 November the browser tool rejected opening the developer dashboard with “Not allowed.”

---

# Version 0.10.13 — 10 November 2026

- Removed the About this scan disclosure section, its explanatory notes and unused styles from Folder details. Removed the Symbolic links metric row and its rendering assignment. Total file size, exact bytes, Files, Subfolders, Largest files, empty results and incomplete-scan feedback remain.
- All 61 JavaScript tests pass. Checked the generated dialog in isolated headless Chrome for normal light/dark themes, an empty folder, and an incomplete scan at 390px width. Each view shows only the three requested metrics, both removed labels are absent, Close works, and no page errors occur. Visually inspected dark and narrow screenshots.
- All five Python workers are byte-identical to 0.10.12, which passed 91 Python tests; Python tests were not rerun for this UI-only change. Symlink handling and actual runtime files are unchanged.
- Reproducible bundle, generated JavaScript syntax, ZIP integrity, exact packaged-file comparison and installed-file byte verification passed. Updated the existing unpacked installation to 0.10.13 without additional permissions. Reload Colab Extras and refresh Colab to activate. Hosted activation has not been verified. Not committed, pushed or published.

---

# Version 0.10.12 — 10 November 2026

- Removed extension Move/Copy menu entries, destination prompts, JavaScript dispatch/polling code, standalone Python operation entry points, copy verification code and move-only rollback branches. Removed the eight obsolete Move/Copy backend tests and the simulated runtime branch for those operations. Updated the popup, manifest description, README and privacy text.
- Kept extraction's shared temporary staging, safe rename and rollback helpers; they remain internal to extraction. ZIP creation/download, extraction with numbered collisions, folder details, recursive/bulk deletion and selection behavior retain their existing paths. Native Colab Copy path and downloaded-file management are separate features and remain available.
- All 91 remaining Python tests and 61 JavaScript tests pass, including extraction cancellation/rollback and download fallback coverage. All 35 isolated headless Chrome check groups pass for selection, exact child-only deletion, ordinary non-empty-folder deletion, progress placement, runtime changes and errors. Windows Ctrl event semantics were emulated on macOS, not verified on native Windows.
- Verified generated code contains no Move/Copy menu labels, prompts or operation entry points. Reproducible bundle, JavaScript syntax, Python 3.8 grammar, ZIP integrity, exact packaged-file comparison and installed-file byte verification passed. No additional permissions.
- Updated the existing unpacked installation to 0.10.12. Reload Colab Extras and refresh Colab to activate. Hosted activation has not been verified; browser operations were simulated and backend tests used disposable local fixtures. No user runtime files were changed. Not committed, pushed or published.

---

# Version 0.10.11 — 10 November 2026

- Fixed parent folders remaining selected after opening them and Command/Ctrl-selecting children. A failing regression against 0.10.10 showed the enclosing folder still present alongside two selected child files; the deletion planner correctly but unintentionally collapsed that selection to the whole parent folder.
- Selecting a child now removes selected ancestors, and explicitly selecting a folder replaces selected descendants. Unrelated selections and similarly named siblings are retained. Deletion and progress are driven by the resulting exact selection, so deleting child items neither deletes the enclosing folder/unselected siblings nor gives them circles. The existing recursive behavior remains when the folder itself is explicitly selected. Circle placement remains on the right.
- All 61 JavaScript tests, 33 Python deletion tests and 35 isolated headless Chrome check groups pass. New coverage includes two child files, mixed child file/folder selection, ancestor replacement, explicit whole-folder selection, exact worker arguments, only the expected progress rows, refresh/re-expansion, and real disposable local deletions that preserve the enclosing folder and unselected contents. Windows Ctrl event semantics were emulated on macOS, not verified on native Windows.
- Visually inspected the dark-theme nested-selection screenshot: only first.txt and second.txt have circles; their parent, nested folder and keep.txt do not. All five Python workers are byte-identical to 0.10.10. Reproducible bundle, JavaScript syntax, ZIP integrity, exact packaged-file comparison and installed-file byte verification passed. No additional permissions.
- Updated the existing unpacked installation to 0.10.11. Reload Colab Extras and refresh Colab to activate. Hosted activation/deletion has not been verified for this version; browser runtime operations were simulated, and deletion tests used disposable local fixtures. Not committed, pushed or published.

---

# Version 0.10.10 — 10 November 2026

- The normal native folder Delete menu entry now dispatches the extension's recursive deletion worker, which handles non-empty folders and their nested/hidden contents. Previously only the separate Delete folder and contents entry or a batch operation used that worker; the ordinary single-folder entry fell through to Colab's empty-folder-only action. A browser regression reproduced that fall-through against 0.10.9 before the fix.
- Mouse activation phases are intercepted before Closure's native deletion runs. The native entry also supports keyboard activation, and the folder's menu button targets its current folder rather than an earlier selection. Protected roots are disabled. The separate recursive Delete entry remains only as a fallback if the native entry is absent, avoiding duplicate Delete choices. Single-file native actions and group-only menus retain their existing behavior.
- All 32 Python deletion tests, 60 JavaScript tests and 29 isolated headless Chrome check groups pass. Backend coverage includes deletion of nested/hidden/empty contents, sibling preservation, links, mounted paths and partial failures. Browser coverage includes the normal Delete entry, visible child progress, exact target dispatch, keyboard/menu-button activation, protected folders, fallback, multi-selection, immediate actions without dialogs and right-side circles. Windows Ctrl event semantics were emulated on macOS, not verified on native Windows.
- All five Python workers are byte-identical to 0.10.9. Reproducible bundle, JavaScript syntax, ZIP integrity, exact packaged-file comparison and installed-file byte verification passed. Updated the existing unpacked installation to 0.10.10 with no additional permissions. Reload Colab Extras and refresh Colab to activate. Hosted activation/deletion has not been verified for this version; browser runtime operations were simulated, and real deletion tests used disposable local fixtures. Not committed, pushed or published.

---

# Version 0.10.9 — 10 November 2026

- Restored loading circles to the right of file/folder names for batch operations by using the shared status-row placement. Removed the batch-only leading placement. All selected items and visible affected descendants still have individual circles, including queued targets, refreshed rows and newly expanded children. Confirmation-free actions and silent success remain unchanged.
- All 60 JavaScript tests and 23 isolated headless Chrome check groups pass. The existing layout check now verifies that each circle is visually to the right of its name on the same row. Per-target completion, refresh, selection clearing, descendant visibility, partial failures and the other selection behavior remain covered. Windows Ctrl event semantics were emulated on macOS, not verified on native Windows.
- Visually inspected the dark-theme browser screenshot after row refresh and folder re-expansion. All five Python workers are byte-identical to the 0.10.8 bundle, which passed 98 Python tests; Python tests were not rerun for this presentation-only change. The overlay-filesystem deletion fix is retained.
- Reproducible bundle, JavaScript syntax, ZIP integrity, exact packaged-file comparison and installed-file byte verification passed. Updated the existing unpacked installation to 0.10.9 with no additional permissions. Reload Colab Extras and refresh Colab to activate. Hosted activation has not been verified. Not committed, pushed or published.

---

# Version 0.10.8 — 10 November 2026

- Confirmed the cause with read-only diagnostics in the user's connected hosted Colab runtime (Python 3.13.18): `/content` reported device 47, both selected ordinary ZIPs reported device 48, and `os.path.ismount()` incorrectly returned true. The root filesystem was `overlay`; neither ZIP appeared in `/proc/self/mountinfo`. No runtime files were changed or deleted. This matches the [Linux overlayfs documentation](https://docs.kernel.org/filesystems/overlayfs.html#overlay-objects): non-directory objects can report a different device from directories on the same overlay mount.
- Linux deletion now uses the process's [actual mount table](https://man7.org/linux/man-pages/man5/proc_pid_mountinfo.5.html), decoding escaped mount paths and comparing them with the physical pinned parent path. Ordinary overlay files are deletable. Actual file/directory mounts, same-device bind mounts and selected trees containing mounts are refused before deletion. Ordinary contents inside a mounted filesystem remain deletable. Unreadable or malformed Linux mount tables fail without deleting anything. Existing protected-root, symlink, changed-target, recursive deletion and partial-error behavior remains.
- A disposable two-ZIP regression reproduced the exact reported error before the change by emulating the observed overlay device IDs; it passes after the fix and verifies preservation of the unselected ZIP, folder and sibling file. All 98 Python tests pass, including same-device bind mounts, nested file/directory mounts, mounted ancestors, similar path prefixes, escaped paths, malformed/unreadable mount tables and non-Linux fallback. Mount records and overlay metadata are simulated on the local macOS filesystem; live Linux deletion was not performed.
- All 60 JavaScript tests and 23 isolated headless Chrome check groups pass with the generated bundle. Immediate batch actions, leading per-row loading circles, selection gestures, group-only menus, partial failures and runtime isolation remain covered. Windows Ctrl event semantics were emulated on macOS, not verified on native Windows.
- Reproducible bundle, generated JavaScript syntax, Python 3.8 grammar, ZIP integrity, exact packaged-file comparison and installed-file byte verification passed. Updated the existing local unpacked installation with no new permissions. Reload Colab Extras in Chrome's Extensions page and refresh Colab to activate. Hosted activation of 0.10.8 has not been verified. Not committed, pushed or published.

---

# Version 0.10.7 — 10 November 2026

- Removed the batch deletion confirmation dialog. Context-menu and keyboard deletion start immediately after validating and snapshotting the target paths. The extension's single-folder Delete folder and contents command now uses the same worker without a confirmation. Successful completion is silent. Menu labels no longer imply an additional dialog.
- Every selected row and visible affected descendant receives its own leading loading circle before asynchronous runtime setup begins, including queued targets. Row progress belongs to the immutable job snapshot, so clearing selection, automatic row replacement, folder collapse/re-expansion and newly visible descendants preserve the correct pending indicators. Each completed/failed root stops its affected circles independently; unrelated siblings never receive a circle.
- Per-row status belongs to the parent batch lock. Completion, partial failure, startup failure, lost connections and runtime changes stop the appropriate rings. Errors remain inline; completed items do not acquire unrelated failure messages. Repeated Delete keys are consumed during the operation to prevent native duplicate deletion.
- All 60 JavaScript tests and 23 isolated headless Chrome check groups pass. They cover immediate execution without dialogs, leading animated circles on all affected rows, progress before worker startup, per-item completion, deduplication, visible descendants, row replacement, selection clearing, partial/startup/connection failures, single-folder deletion, keyboard activation/repetition, runtime changes and group-only menus. Windows Ctrl event semantics were emulated on macOS, not verified on native Windows. The unchanged Python workers retain their 90 passing tests from 0.10.3 and were not rerun.
- Visually inspected the simulated dark-theme progress display. Reproducible bundle, JavaScript syntax, ZIP integrity, exact packaged-file matching and installed-file byte verification passed. No additional permissions. Hosted Colab activation was not live-verified; reload the extension and refresh Colab. No real runtime files were deleted during browser testing. Not committed, pushed or published.

---

# Version 0.10.6 — 10 November 2026

- Corrected outside deselection to left-click. Left-clicking blank space in the sidebar, inside an expanded folder or elsewhere on the page clears the selection; ordinary row clicks select one item. Right-clicking blank space preserves the selection, and right-clicking a selected row preserves the group. Menu actions and the deletion confirmation are exempt so their clicks do not erase the batch.
- Group context menus now expose only implemented batch actions: currently Delete selected items. Both native and extension single-item commands, plus separators, are hidden. Native hidden items are inert and excluded from the accessibility tree. Group keyboard navigation and activation are handled explicitly so Closure's internal list cannot invoke hidden single-item commands. Single-item contexts restore the ordinary commands.
- All 58 JavaScript tests and 25 isolated headless Chrome check groups pass. Coverage includes mixed/folder/archive groups, only one visible group command, hidden separators, mouse and keyboard activation, single-item action restoration, outside left-click versus right-click, menu/confirmation selection preservation, refresh, running jobs, partial failures, runtime changes and existing gesture behavior. Windows Ctrl event semantics were emulated on a macOS host, not tested on a native Windows OS. The unchanged Python workers retain their 90 passing tests from 0.10.3 and were not rerun.
- Visually inspected the dark-theme group menu in the simulated runtime. Reproducible build, generated JavaScript syntax, ZIP integrity, exact packaged-file matching and installed-file byte verification passed. No additional controls or permissions. Hosted activation was not live-verified; reload the extension and refresh Colab. Not committed, pushed or published.

---

# Version 0.10.5 — 10 November 2026

- Right-clicking outside the selected file/folder title rows clears the entire selection instead of selecting the new target. Covers other file/folder rows, blank sidebar space, blank space inside an expanded selected folder, and the rest of the page. Right-clicks on a selected row, including its icons/menu button, preserve the group. Open bulk Delete menus update immediately when selection clears, and refresh does not restore cleared highlights.
- Clearing highlights does not change an already-confirmed deletion plan. Failures still display on the affected rows when the selection was cleared; those items do not reselect themselves. No new controls or permissions.
- All 58 JavaScript tests and 23 isolated headless Chrome check groups pass. The browser checks cover Mac gestures and Windows Ctrl event semantics emulated on a macOS host, including outside-row clearing, selected-row preservation, menu state, refresh persistence, a running job, and errors after selection clears. The unchanged Python workers retain their 90 passing tests from 0.10.3 and were not rerun.
- Reproducible bundle, generated JavaScript syntax, ZIP integrity, exact packaged-file comparison and local installed-file byte verification passed. Hosted Colab activation and native Windows OS behavior were not live-verified. Reload the extension and refresh Colab to activate. Not committed, pushed or published.

---

# Version 0.10.4 — 10 November 2026

- Replaced selection checkboxes and the entire selection toolbar with Command-click on Mac and Ctrl-click on Windows/Linux. Modifier clicks toggle a file or folder without opening it; ordinary clicks select one row and retain native Colab behavior. Selected title rows use Colab's existing highlighted-surface colour. Native rename inputs, menu/action buttons and expansion arrows are excluded from the selection gesture.
- Reuse the existing native Delete menu entry for a selected group, removing the redundant extension folder-delete entry from that group menu. The native entry is restored outside a group. Both mouse-up and click activation are intercepted, along with keyboard activation, so Colab's original single-item delete cannot also run. A fallback context-menu entry is used only if the native Delete entry cannot be identified. Right-click on an unselected row switches to that item. Escape clears focused selection; Delete or Mac Command-Backspace opens the exact-path confirmation.
- All 58 JavaScript tests pass. The unchanged deletion and archive Python workers retain their 90 passing tests from 0.10.3 and were not rerun.
- Seventeen isolated headless Chrome check groups pass with the generated bundle under Trusted Types: eight for Mac input, eight for Windows modifier semantics and a no-page-errors check. Coverage includes toggle/highlight, absence of added selection controls, native-menu reuse, mouse-up/click/keyboard interception, cancellation, mixed deletion, plain/right click, protected roots, descendant deduplication, partial failures, busy refresh, unknown results, runtime changes, rename/arrow isolation, shortcuts and dark/narrow layouts. Windows event fields were emulated on a macOS host, which turns physical Ctrl-click into a secondary click; this is not native Windows OS verification.
- Inspected the current hosted Colab file-row markup, highlight colour and native Delete menu to ground the integration. No hosted runtime files were deleted. Screenshots from the isolated browser harness were visually inspected. Version 0.10.4 activation on hosted Colab has not been verified; the user needs to reload the extension and refresh Colab.
- Reproducible build, generated JavaScript syntax, ZIP integrity and exact packaged-file comparison verified. Updated and byte-verified the local unpacked installation with no additional permissions. Not committed, pushed or published.

---

# Version 0.10.3 — 10 November 2026

- Added checkboxes for files and folders, Select visible, Clear, and Delete selected in the Files sidebar. Protected roots and job paths cannot be selected. A keyboard-accessible confirmation lists every effective deletion target and makes recursive, permanent deletion explicit; selected parent/child paths are deduplicated.
- One independent runtime worker processes the confirmed selection. It validates all request paths before deleting, rejects changed file types, selected symlinks, symlink parents, mounted trees and special files, and continues past individual failures. Successful targets clear from the selection; failed targets remain selected with per-path errors and partial-deletion warnings. Unknown results after a connection loss are not automatically retried.
- Selection survives row replacement, is locked during execution, and is cleared on runtime changes. No persistent selection/history data, no Undo and no additional permissions. Ordinary notebook output changes do not trigger full file-row rescans.
- All 90 Python tests and 57 JavaScript tests pass. Backend tests operate on disposable local fixtures and cover mixed selection, recursion, overlapping selection, siblings, malformed/protected paths, changed types, symlinks, file replacement, permission/partial failures, mounts, and CLI status errors. JavaScript tests cover cancellation before requests, exact plans and result validation, partial/unknown results, locking and runtime changes. Existing automatic-download and numbered-extraction coverage remains passing.
- Eight isolated headless Chrome check groups pass using the exact generated bundle under Trusted Types: selection/root protection/row refresh/confirmation cancellation; mixed deletion; parent-child deduplication/Escape/Clear/Select visible; partial failure; busy controls and row replacement; connection loss without duplicate requests; runtime isolation/keyboard/dark narrow layout; absence of page errors. Light and dark confirmation screenshots were visually inspected. This is a simulated Colab runtime, not hosted Colab verification; no real runtime files were deleted during browser testing.
- Reproducible bundle, JavaScript syntax, Python 3.8 grammar, ZIP integrity and exact packaged-file comparison verified. Local unpacked files updated; reload Colab Extras and refresh Colab to activate. No commit, push or publication.

---

# Version 0.10.2 — 10 November 2026

- Reproduced the reported `Already exists; nothing was overwritten: sample_data/README.md` failure with a disposable archive and pre-existing folder before changing the worker.
- Default extraction now preserves existing top-level files/folders and creates numbered siblings. An entire existing folder extracts into `sample_data (1)`, then `(2)`, etc.; it is not merged into the original. File copies retain their extension. Names declared elsewhere in the same archive are reserved to prevent unrelated roots from being mixed together.
- Fresh top-level folders are claimed with exclusive directory creation; concurrent collisions choose another name. Loose-file publication uses exclusive creation and retries a numbered name if a collision appears after preflight. Existing symlinks are not followed. Explicit overwrite mode remains available and unchanged.
- All 78 Python tests and 48 JavaScript tests pass. Regression cases cover the supplied sample_data scenario, repeated extraction with numbered ZIP names, nested/empty folders, existing numbered destinations, mixed archive roots, loose-file extensions, ZIP/TAR/TAR.GZ/TGZ, symlink collisions, concurrent creation, cancellation cleanup and preservation of original contents. Automatic downloads and Undo removal retain their regression coverage.
- Reproducible build, generated JavaScript syntax, Python 3.8 grammar, ZIP integrity and exact packaged-file matching passed. Local unpacked files are updated; reload the extension and refresh Colab. Validation used real local disposable filesystem fixtures; hosted Colab activation and extraction were not live-verified for this version. Not pushed or published.

---

# Version 0.10.1 — 10 November 2026

- ZIP and download is always active. Removed the tracking preference toggle and ignore its previously saved value. Optional download permission is checked while the ZIP is prepared; missing permission or an unavailable helper selects Colab's ordinary download automatically. A dispatched download is never retried through another route after an uncertain response.
- Downloads start immediately after archive creation, before terminal cleanup or sidebar refresh. ZIP only still saves without downloading. Tracked downloads explicitly request `saveAs: false`, as documented by the [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads#type-DownloadOptions).
- All 48 JavaScript tests pass, covering the previous true/false/missing tracking preference, missing permission, unavailable helper with a one-second timeout, granted permission, cancelled downloads, no duplicate fallback after dispatch, and download-before-cleanup ordering. The unchanged Python workers retain their 72 passing tests from 0.10.0 and were not rerun.
- Generated JavaScript syntax, reproducible build, ZIP integrity, and packaged-file equality passed. The local unpacked files are updated; Chrome still needs an extension reload and Colab refresh. This version has not been live-tested on hosted Colab, pushed, or published.

---

# Version 0.10.0 — 10 November 2026

- Removed the Undo toolbar control, completed-operation history, native upload/file interception, sidebar/folder/preference tracking, and background history polling. Startup regression coverage verifies the original native file APIs remain untouched and no history timer starts.
- Retained ZIP and download, archive extraction with optional replacement, folder details, copy/move, popup preferences, optional managed downloads, and quiet progress. Folder deletion uses the existing permanent-deletion worker and an explicit confirmation. Failed/cancelled extraction still rolls back the running operation; successful operations remove temporary originals rather than retain backups for later Undo. Older recovery folders are left untouched.
- 72 Python tests and 41 JavaScript tests pass. Added coverage includes copy/move success and occupied paths, cross-filesystem publication failure with source restoration, source changes during copying, extraction replacement/cancellation/conflicts, cleanup of temporary originals, and a status-write failure after commit. ZIP cancellation after archive publication retains the saved ZIP.
- Chrome checks against the generated bundle in the simulated-Colab harness verified there is no Undo control at startup or after ZIP/extraction/copy, ordinary context-menu actions remain, all three operations complete and clear progress, and deletion presents a permanent-delete confirmation. The simulated deletion was not confirmed. A later screenshot attempt failed because browser control timed out; no screenshot is claimed.
- Final generated JavaScript syntax, Python 3.8 grammar, reproducible build, ZIP integrity, and packaged-file equality are verified during packaging. These tests use disposable local fixtures and a simulated browser; no hosted Colab filesystem operation was run for this version.
- Local extension files are updated; Chrome needs an extension reload and Colab page refresh. This version has not been pushed, released on GitHub, or submitted to the Chrome Web Store.

---

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
