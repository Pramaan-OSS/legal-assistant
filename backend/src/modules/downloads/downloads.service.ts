// Business logic + data-access for the downloads module.
//
// Service layer behind downloads.routes.ts. Takes an explicit Supabase client
// (`db`) plus request-derived primitives, resolves a signed download token to
// the bytes it grants access to, and RETURNS a typed result. It never touches
// req/res — the route maps the result onto status codes, headers, and body.

import type { Db } from "../../lib/supabase";
import type { Readable } from "node:stream";
import {
    BlobUploadSizeError,
    downloadFile,
    writeBlobFromStream,
} from "../../lib/storage";
import {
    verifyBlobToken,
    verifyDownload,
} from "../../lib/downloadTokens";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import { ensureDocAccess } from "../../lib/access";
import {
    contentTypeForDocumentType,
    documentSuffix,
} from "../../lib/documentTypes";

function contentTypeFor(filename: string): string {
    return contentTypeForDocumentType(documentSuffix(filename));
}

/**
 * Resolve a filesystem-driver blob token (the fs stand-in for an S3 presigned
 * GET) to its bytes. The token itself is the authorization: it is minted only
 * after an authenticated caller's access check, matching the S3 presigned URLs
 * used by the cloud storage driver.
 */
export async function resolveBlobDownload(token: string): Promise<
    ServiceResult<{ bytes: Buffer; contentType: string; filename: string }>
> {
    const info = verifyBlobToken(token);
    if (!info) return failure("not_found", "Invalid or expired link");
    const bytes = await downloadFile(info.path);
    if (!bytes) return failure("not_found", "File not found");
    return ok({
        bytes: Buffer.from(bytes),
        contentType: contentTypeFor(info.filename),
        filename: info.filename,
    });
}

/**
 * Redeem a filesystem-driver upload token (the fs stand-in for an S3 presigned
 * PUT) by streaming the request body to disk.
 *
 * The declared content type and byte count are inside the signature, so an
 * oversized or mistyped body is rejected and the partial file removed, which
 * is how the S3 URL behaves (S3 fails signature validation on a Content-Length
 * that differs from the signed one).
 */
export async function storeBlobUpload(args: {
    token: string;
    contentType: string;
    body: Readable;
    userId?: string;
    db?: Db;
}): Promise<ServiceResult<void>> {
    let requested: { p?: string; t?: string; s?: number };
    try { if (!/^[A-Za-z0-9_-]{1,4096}$/.test(args.token)) throw new Error('Invalid descriptor.'); requested = JSON.parse(Buffer.from(args.token, 'base64url').toString()); if (!requested || typeof requested !== 'object' || Array.isArray(requested)) throw new Error('Invalid descriptor.'); }
    catch { return failure('forbidden', 'Invalid upload request'); }
    if (!args.userId || !args.db || typeof requested.p !== 'string') return failure('forbidden', 'Sign in before uploading.');
    const { data: file, error: fileError } = await args.db.from('upload_session_files').select('*').eq('staging_storage_path', requested.p).maybeSingle();
    if (fileError || !file) return failure('forbidden', 'Upload request is unavailable.');
    const { data: session, error: sessionError } = await args.db.from('upload_sessions').select('*').eq('id', file.session_id).eq('user_id', args.userId).maybeSingle();
    if (sessionError || !session || session.status !== 'pending_upload' || (!Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) < Date.now()) || file.status !== 'pending_upload') return failure('forbidden', 'Upload request is unavailable or expired.');
    const info = { path: file.staging_storage_path as string, contentType: file.content_type as string, sizeBytes: file.expected_size_bytes as number };
    if (requested.t !== info.contentType || requested.s !== info.sizeBytes) return failure('forbidden', 'Upload request changed.');
    const declaredType = args.contentType.split(";")[0].trim();
    if (declaredType && declaredType !== info.contentType) {
        return failure("validation", "Upload content type does not match the link");
    }
    try {
        await writeBlobFromStream(info.path, args.body, info.sizeBytes, info.contentType);
    } catch (error) {
        // writeBlobFromStream commits only on success, so a failed upload
        // leaves no partial file and any existing blob at the key intact.
        if (error instanceof BlobUploadSizeError) {
            return failure("validation", "Upload size does not match the link");
        }
        return internalFailure(error);
    }
    return ok(undefined);
}

/**
 * Resolve a signed download token to file bytes, enforcing that the token's
 * storage path is still backed by a live document version the caller can
 * access. Every failure after token verification collapses to "not_found" so
 * a valid-looking token cannot be used to probe for foreign files.
 */
export async function resolveTokenDownload(
    db: Db,
    args: { token: string; userId: string; userEmail: string | undefined },
): Promise<
    | { ok: true; bytes: Buffer; contentType: string; filename: string }
    | { ok: false; kind: "invalid_link" | "not_found" }
> {
    const info = verifyDownload(args.token);
    if (!info) return { ok: false, kind: "invalid_link" };

    const { data: version } = await db
        .from("document_versions")
        .select("id, document_id")
        .eq("storage_path", info.path)
        .is("deleted_at", null)
        .maybeSingle();
    if (!version) return { ok: false, kind: "not_found" };

    const { data: doc } = await db
        .from("documents")
        .select("id, user_id, project_id, org_id, workflow_id")
        .eq("id", (version as { document_id: string }).document_id)
        .single();
    if (!doc) return { ok: false, kind: "not_found" };

    const access = await ensureDocAccess(doc, args.userId, args.userEmail, db);
    if (!access.ok) return { ok: false, kind: "not_found" };

    const raw = await downloadFile(info.path);
    if (!raw) return { ok: false, kind: "not_found" };

    return {
        ok: true,
        bytes: Buffer.from(raw),
        contentType: contentTypeFor(info.filename),
        filename: info.filename,
    };
}
