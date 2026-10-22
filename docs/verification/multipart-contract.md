# Multipart contract check

Checked fetched capabilities-lab `origin/main` at c9bc5defaeb3323233453a82d8b6a58c5562d0e6. No live API calls.

- SDK Requests storage.upload.part.put accepts an owned upload ref, part number and fileId; no raw-byte, base64, source offset or file-range input.
- Platform POST /v1/files validates Content-Type against FILE_TYPES[kind] and then validates the bytes. application/octet-stream is absent from every accepted kind.
- sniff returns undefined for binary bytes without a recognized whole-file signature. A PDF/DOCX chunk starting in the middle of a file is not generally a valid standalone document.
- Uploading each chunk as an encoded ZIP changes its bytes; assembling those parts cannot reproduce the original document.
- storage.upload.part.copy requires an already-existing object in the connected storage account. It cannot bootstrap a new app-local large upload.

Evidence paths on that commit: packages/sdk/src/generated/types.ts (Requests storage.upload.part.put); packages/files/src/limits.ts (FILE_TYPES); packages/files/src/service.ts (upload Content-Type and sniff checks); packages/files/src/sniff.ts (signature and looksLikeText); Requests storage.upload.part.copy (sourceBucket/sourcePath/range).

Result: multipart capability ids exist, but arbitrary app-proxied new binary parts cannot be created through the available file upload contract. Request raw binary platform uploads, or raw-byte/range support on part.put. Owner/PID alternative: approve local-only large-file storage until lab coverage exists.

Additional whole-file check: FILE_TYPES.document accepts PDF, DOCX and plain text; FILE_TYPES.data accepts CSV/JSON/NDJSON/ZIP. Legacy DOC/PPT/XLS binary types are absent. storage.object.put.content accepts at most 1 MiB; larger legacy files below the own-disk size threshold cannot be transferred without the same missing raw binary staging support. Current Office ZIP containers can be staged unchanged as ZIP and stored with their real media type. The app must show an explicit format message instead of altering bytes.


## Superseded after PRA-35 landed

Read the five multipart contracts and files guide at lab f6e5f09c8e62645d30bf3d2e3b388e1fc6285d48. Raw bytes can now be uploaded to POST /v1/files?kind=part as application/octet-stream, up to 8 MiB. part.put still takes the returned fileId. Parts other than the last must be at least 5 MiB, total upload at most 1 GiB. A part has no public link; delete each acknowledged part file to free the 1 GB staging allowance. Complete/abort also clean part files.

Completion returns bucket/path/size, not a checksum. The currently inspected storage adapter declines checksum and range options despite their catalogue fields; the template uses no unsupported options. It verifies full bytes through a capability-issued private download link consumed only by the server client, comparing SHA-256 to the stable local source. This resolves the original raw-part blocker, without claiming live readiness. The ≤25 MB whole-file media-type limitation described above remains separate.
