# Colab Extras — Privacy policy

Effective 10 November 2026 · Extension version 0.10.14

Colab Extras provides file tools in Google Colab. It does not send your files, notebook contents, or operation data to the developer or an external file-processing service.

## Information used

For requested file operations, the extension reads file paths, names, metadata, contents, and results. ZIP creation, extraction, and verification run inside your connected runtime. Native Colab upload, rename and folder-creation APIs are not intercepted or recorded. When multiple rows are selected, the existing Delete menu entry acts on that group. The current sidebar location is read in page memory to show a Back to /content shortcut outside the session folder. Sidebar locations, folder expansion, and preference changes are not tracked as history.

The extension does not collect unrelated browsing history, passwords, keystrokes, analytics, advertising identifiers, or payment information. It does not require an extension account.

## Temporary storage

Temporary worker scripts and status files use `.colab-folder-zip-*` directories. Extraction may stage files and retain originals temporarily while an operation runs. These temporary directories are removed after successful completion where possible. Failed or interrupted operations and rollback conflicts can leave staging files; errors identify retained originals when available. No persistent completed-operation history or Undo backups are created.

Upgrading does not automatically delete recovery data created by older versions. Disabling or uninstalling the extension does not remove runtime files, mounted-drive files, or old recovery data. Preferences are saved in Colab-origin local storage and can be cleared through the browser's site-data controls.

## Optional browser downloads

ZIP and download starts automatically after archive creation, without an activation setting. Without optional downloads permission, it uses Colab's normal download. When the optional permission has been granted, the extension uses Chrome's downloads API to create and track its own ZIP downloads automatically. Chrome asks for the downloads permission only if you choose to enable optional tracking in the popup.

The extension stores the download ID, operation ID, filename, and timestamp in Chrome extension local storage. It checks the state and local path of those tracked downloads when displaying its popup. The popup can cancel a tracked download or, after confirmation, permanently remove its local file. It does not manage downloads created by other extensions or other untracked downloads. Webpages cannot request local-file removal through the extension's message bridge. Download records remain until extension storage is cleared or the extension is uninstalled.

## Processing and access

The interface runs on `https://colab.research.google.com/`. Runtime operations use bundled scripts and independent Jupyter terminals on the same Colab virtual machine; they do not add or execute notebook cells. The extension uses the runtime connection and mounted-drive access already granted to Colab, without creating a separate credential store. Google processes information under its own terms and [privacy policy](https://policies.google.com/privacy).

The required `storage` permission stores metadata for the extension's own optional downloads. The `downloads` permission is optional and is used only for the management described above. No remote executable code is downloaded by the extension.

## Choices and limitations

You choose which actions to run. Extraction preserves existing files and folders by creating numbered copies by default; the popup can explicitly enable permanent replacement instead. Failed or cancelled extraction attempts rollback of the running operation while preserving later changes. Extension runtime file and folder deletion, including bulk deletion, starts immediately without a confirmation dialog. Deletion is permanent and does not use Trash. File selections are held in page memory for the connected runtime and are not stored as history. Completed operations cannot be reversed through the extension.

You can disable or uninstall Colab Extras in Chrome. The developer receives none of the operation data. Chrome Web Store may provide aggregate installation statistics and feedback that you submit.

## Data use and contact

Colab Extras does not sell data, transfer it for unrelated purposes, use it for advertising, or use it for creditworthiness or lending decisions. Its handling of data follows the Chrome Web Store User Data Policy, including Limited Use requirements.

For questions, use the [issue tracker](https://github.com/luisdrita/colab-extras/issues) or the developer contact on the Store listing. Do not include confidential data in public reports. This privacy page has no tracking scripts; its hosting provider may process ordinary connection data. Colab Extras is independent and is not affiliated with or endorsed by Google.
