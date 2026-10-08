# Colab Extras — Privacy policy

Effective 8 October 2026 · Extension version 0.8.0

Colab Extras adds folder inspection, ZIP creation, ZIP download, archive extraction, and confirmed folder deletion to Google Colab. It does not send your folders, files, or notebook contents to the extension's developer or to an external compression service.

## Information used by the extension

The extension reads file and folder names and paths from Colab's Files sidebar when you open a file or folder menu. When you select an action, it handles the information needed for that action: the selected path, file and folder metadata, file sizes, operation progress, and errors. Folder details displays counts and relative paths for the largest files.

ZIP creation reads the selected folder's contents inside your connected Colab runtime. ZIP and download transfers the resulting archive to your browser through Colab's existing file-download connection. Deletion removes the selected folder and its contents only after a confirmation naming the path. It is permanent and bypasses Trash, including on mounted drives.

The extension does not collect browsing history from other websites, read notebook cell contents for analytics, record keystrokes, collect passwords, or maintain an advertising or usage profile. It has no extension account, analytics service, advertising, telemetry, or payment processing.

Extract here reads the selected archive inside the runtime and writes its regular files and directories beside it. It retains the original archive and never overwrites existing files. Completed extracted files and directories can remain after cancellation or failure; they remain until you remove them or the runtime storage is reset.

## Where processing happens

The interface runs in your browser on `https://colab.research.google.com/`. File operations run in your connected Colab virtual machine using scripts bundled with the extension and a separate terminal process. They use the same virtual machine's resources without adding or queueing a notebook cell.

The extension uses Colab's existing authenticated connection. It does not ask you to provide credentials or create a separate credential store. If you select folders on a mounted drive, the operation uses access you have already granted to Colab. Google processes information under its own service terms and [privacy policy](https://policies.google.com/privacy).

## Storage and retention

Selected paths and interface state are held in the current page's memory. Temporary scripts and status files are written to an extension job directory in the runtime. Completed operations clean up their own temporary data when possible; interrupted or disconnected operations can leave staging files. ZIP files remain beside their source folders until you remove them or the runtime storage is reset. Downloaded archives remain wherever your browser saves them.

The developer does not receive or retain a copy of this operation data. Chrome Web Store may separately provide the developer with aggregate installation and rating statistics and any feedback you choose to submit. Do not include confidential notebook data or credentials in public feedback.

## Data use and sharing

Data handling is limited to providing the file and folder actions you request. Colab Extras does not sell user data, transfer it for unrelated purposes, use it for advertising, or use it to assess creditworthiness or lending eligibility. Its handling of data follows the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Your choices

You control which file or folder and action to select. You can cancel an active scan, ZIP, or extraction operation, subject to completion of an in-progress filesystem request. Deletion cannot be cancelled after confirmation. You can disable or uninstall the extension through Chrome. Uninstalling does not erase archives, downloaded files, or staging files already created in your runtime.

## Contact and changes

For questions about this extension or policy, use the [Colab Extras issue tracker](https://github.com/luisdrita/colab-extras/issues), or the developer contact information on the Chrome Web Store listing when available. Future changes to data handling will be reflected in an updated policy and, when needed, the extension's disclosures.

This policy page's own code contains no tracking or analytics scripts. When hosted online, its hosting provider may process ordinary connection data to serve the page. Colab Extras is an independent extension and is not affiliated with or endorsed by Google.
