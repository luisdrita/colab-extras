# Colab Extras — Privacy policy

Effective 20 October 2026 · Extension version 0.9.2

Colab Extras provides file tools and Undo in Google Colab. It does not send your files, notebook contents, recovery copies, or operation history to the developer or an external file-processing service.

## Information used

On Colab pages the extension reads file paths, names, metadata, contents required for requested operations, operation results, and sidebar locations. It intercepts supported Files sidebar uploads, replacements, creations, renames, and deletions inside `/content` while active so that it can retain recovery data before changing files. ZIP creation, extraction, copying, hashing, and restoration run inside your connected runtime.

The extension does not collect unrelated browsing history, passwords, keystrokes, analytics, advertising identifiers, or payment information. It does not require an extension account.

## Recovery and storage

Operation journals are stored in `/content/.colab-folder-zip-undo`. Deleted and replaced items, staged uploads, and outputs removed by Undo are retained in hidden `.colab-folder-zip-recovery-*` directories on the affected filesystem. This retention uses storage; Undo is not a secure erase or a way to reclaim all retained disk space. Filesystem metadata is preserved where supported.

There is no automatic backup expiry in this release. Runtime-local records and copies disappear when the runtime is deleted. Recovery copies on mounted drives can outlive the runtime, but losing the runtime journal prevents automatic recovery through this release. Uninstalling the extension does not remove these runtime or Drive copies. Removing recovery folders yourself invalidates the associated Undo records.

Temporary worker scripts and status files are removed after completion when possible. Connection loss can leave staging files. Sidebar location history and settings-change history are held in the current tab. Preferences are saved in Colab-origin local storage and can be cleared through the browser's site-data controls.

## Optional browser downloads

Ordinary ZIP downloads continue to work without the downloads permission. If you enable optional download management in the extension popup and select tracking in its popup settings, the extension uses Chrome's downloads API to create and track its own ZIP downloads. Chrome asks for the downloads permission when you enable this feature.

The extension stores the download ID, operation ID, filename, and timestamp in Chrome extension local storage. It checks the state and local path of those tracked downloads when displaying its popup. The popup can cancel a tracked download or, after confirmation, permanently remove its local file. It does not manage downloads created by other extensions or other untracked downloads. Webpages cannot request local-file removal through the extension's message bridge. Download records remain until extension storage is cleared or the extension is uninstalled.

## Processing and access

The interface runs on `https://colab.research.google.com/`. Runtime operations use bundled scripts and independent Jupyter terminals on the same Colab virtual machine; they do not add or execute notebook cells. The extension uses the runtime connection and mounted-drive access already granted to Colab, without creating a separate credential store. Google processes information under its own terms and [privacy policy](https://policies.google.com/privacy).

The required `storage` permission stores metadata for the extension's own optional downloads. The `downloads` permission is optional and is used only for the management described above. No remote executable code is downloaded by the extension.

## Choices and limitations

You choose which actions to run. Extraction preserves existing files by default. A setting in the extension popup enables replacement while retaining originals. Cancellation attempts to reverse completed steps while keeping later changes. Conflicts are reported instead of overwriting newer work. Arbitrary notebook code, terminal commands, other users' activity, and actions before tracking began are outside Undo's coverage.

You can disable or uninstall Colab Extras in Chrome. Uninstalling does not delete files already created, downloaded, or retained for recovery. The developer receives none of the operation data. Chrome Web Store may provide aggregate installation statistics and feedback that you submit.

## Data use and contact

Colab Extras does not sell data, transfer it for unrelated purposes, use it for advertising, or use it for creditworthiness or lending decisions. Its handling of data follows the Chrome Web Store User Data Policy, including Limited Use requirements.

For questions, use the [issue tracker](https://github.com/luisdrita/colab-extras/issues) or the developer contact on the Store listing. Do not include confidential data in public reports. This privacy page has no tracking scripts; its hosting provider may process ordinary connection data. Colab Extras is independent and is not affiliated with or endorsed by Google.
