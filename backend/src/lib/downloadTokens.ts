import crypto from "crypto";

/** App-owned download descriptors are authorized by the normal session on the download route.
 * Expiring upload tokens below are signed separately to bind their size and media type.
 */

function getSecret(): string {
    const secret = process.env.DOWNLOAD_SIGNING_SECRET;
    if (!secret) {
        throw new Error(
            "DOWNLOAD_SIGNING_SECRET must be set. " +
                "Generate a strong random value (e.g. `openssl rand -hex 32`) and set it in the environment.",
        );
    }
    return secret;
}

function b64urlEncode(buf: Buffer): string {
    return buf
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function b64urlDecode(s: string): Buffer {
    let t = s.replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    return Buffer.from(t, "base64");
}

function timingSafeEqStr(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function signDownload(path: string, filename: string): string {
 return Buffer.from(JSON.stringify({ p: path, f: filename })).toString('base64url');
}
export function verifyDownload(token: string): { path: string; filename: string } | null {
 if (!/^[A-Za-z0-9_-]{1,4096}$/.test(token)) return null;
 try { const value = JSON.parse(Buffer.from(token, 'base64url').toString()) as { p?: unknown; f?: unknown };
  if (typeof value.p !== 'string' || typeof value.f !== 'string' || value.p.length > 2000 || value.f.length > 500) return null;
  return { path: value.p, filename: value.f };
 } catch { return null; }
}

/**
 * Returns a relative download URL (e.g. "/download/abc.def"). Browser clients
 * prefix it with their same-origin `/api` gateway.
 */
export function buildDownloadUrl(path: string, filename: string): string {
    return `/download/${signDownload(path, filename)}`;
}

/**
 * Expiring blob tokens for private filesystem uploads.
 *
 * A presigned URL is a capability: whoever holds it can fetch that one object
 * until it expires, with no session attached (the browser follows it as a
 * plain <a> click, so no Authorization header is available). These tokens
 * reproduce exactly that contract: HMAC over {path, filename, exp}, verified
 * by the unauthenticated `/download/signed/:token` route. Access control
 * happened when the token was minted — the same moment it would have happened
 * for a presigned URL.
 *
 * Unlike `signDownload` above, these DO expire: they replace URLs that always
 * carried an expiry, and the routes that mint them re-check access on every
 * request, so a short lifetime costs nothing.
 */
export function signBlobToken(
    path: string,
    filename: string,
    expiresInSeconds: number,
): string {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload = JSON.stringify({ p: path, f: filename, e: exp });
    const enc = b64urlEncode(Buffer.from(payload, "utf8"));
    const sig = crypto
        .createHmac("sha256", getSecret())
        .update("blob:" + enc)
        .digest();
    return `${enc}.${b64urlEncode(sig)}`;
}

export function verifyBlobToken(
    token: string,
): { path: string; filename: string } | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [enc, sigEnc] = parts;
    const expected = crypto
        .createHmac("sha256", getSecret())
        .update("blob:" + enc)
        .digest();
    if (!timingSafeEqStr(sigEnc, b64urlEncode(expected))) return null;
    try {
        const parsed = JSON.parse(b64urlDecode(enc).toString("utf8")) as {
            p: string;
            f: string;
            e: number;
        };
        if (!parsed?.p || !parsed?.f || typeof parsed.e !== "number") return null;
        if (parsed.e < Math.floor(Date.now() / 1000)) return null;
        return { path: parsed.p, filename: parsed.f };
    } catch {
        return null;
    }
}

/**
 * Write-side twin of `signBlobToken` — the filesystem driver's stand-in for a
 * presigned S3 `PUT`.
 *
 * The S3 URL it replaces binds the object key, the declared content type and
 * the exact byte count into the signature, so the capability cannot be
 * replayed with a different body. This reproduces that: {path, contentType,
 * size, exp} under HMAC, redeemed by `PUT /download/signed/:token`. A distinct
 * HMAC domain ("blob-put:") means a read token can never be spent as a write
 * token, or the reverse, even though both travel on the same route.
 */
export function signBlobUploadToken(
    path: string,
    contentType: string,
    sizeBytes: number,
    expiresInSeconds: number,
): string {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload = JSON.stringify({
        p: path,
        c: contentType,
        s: sizeBytes,
        e: exp,
    });
    const enc = b64urlEncode(Buffer.from(payload, "utf8"));
    const sig = crypto
        .createHmac("sha256", getSecret())
        .update("blob-put:" + enc)
        .digest();
    return `${enc}.${b64urlEncode(sig)}`;
}

export function verifyBlobUploadToken(
    token: string,
): { path: string; contentType: string; sizeBytes: number } | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [enc, sigEnc] = parts;
    const expected = crypto
        .createHmac("sha256", getSecret())
        .update("blob-put:" + enc)
        .digest();
    if (!timingSafeEqStr(sigEnc, b64urlEncode(expected))) return null;
    try {
        const parsed = JSON.parse(b64urlDecode(enc).toString("utf8")) as {
            p: string;
            c: string;
            s: number;
            e: number;
        };
        if (!parsed?.p || !parsed?.c) return null;
        if (typeof parsed.s !== "number" || typeof parsed.e !== "number")
            return null;
        if (parsed.e < Math.floor(Date.now() / 1000)) return null;
        return { path: parsed.p, contentType: parsed.c, sizeBytes: parsed.s };
    } catch {
        return null;
    }
}
