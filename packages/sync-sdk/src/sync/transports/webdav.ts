import { type RemoteTransport, SyncError } from "../../types";
import { assert, hash } from "../../utils/codec";
import { withWebDAVLock } from "./webdav-lock";

export interface WebDAVOptions {
    url: string;
    username?: string;
    password?: string;
    fetch?: typeof fetch;
    /** Auto prefers ETag and falls back to server locks plus content hashes. */
    concurrency?: "auto" | "etag" | "lock";
}
/** Fetch-only transport with native conditional writes or WebDAV server locks. */
export function createWebDAVTransport(options: WebDAVOptions): RemoteTransport {
    const concurrency = options.concurrency ?? "auto";
    assert(
        ["auto", "etag", "lock"].includes(concurrency),
        "Invalid WebDAV concurrency mode",
    );
    let mode: "etag" | "lock" = concurrency === "lock" ? "lock" : "etag";
    const root = new URL(
        options.url.endsWith("/") ? options.url : `${options.url}/`,
    );
    assert(
        ["http:", "https:"].includes(root.protocol) &&
            !root.username &&
            !root.password &&
            !root.search &&
            !root.hash,
        "Invalid WebDAV URL",
    );
    const request = options.fetch ?? globalThis.fetch.bind(globalThis);
    const auth =
        options.username === undefined
            ? undefined
            : `Basic ${btoa(Array.from(new TextEncoder().encode(`${options.username}:${options.password ?? ""}`), (b) => String.fromCharCode(b)).join(""))}`;
    const url = (path: string) => {
        assert(
            !path.startsWith("/") &&
                !path.includes("//") &&
                path
                    .split("/")
                    .every(
                        (part) =>
                            part !== ".." &&
                            part !== "." &&
                            !part.includes("\\") &&
                            !part.includes("%") &&
                            !part.includes("?") &&
                            !part.includes("#"),
                    ),
            "Unsafe remote path",
        );
        return new URL(path.split("/").map(encodeURIComponent).join("/"), root);
    };
    const send = async (path: string, init: RequestInit) => {
        const target = url(path);
        let response: Response;
        try {
            response = await request(target, {
                ...init,
                headers: {
                    ...(auth ? { Authorization: auth } : {}),
                    ...init.headers,
                },
                cache: "no-store",
                redirect: "error",
            });
        } catch {
            throw new SyncError(
                "NETWORK",
                "WebDAV request failed; check network, URL and browser CORS configuration",
            );
        }
        if (response.status === 412 || response.status === 423)
            throw new SyncError(
                "PRECONDITION",
                "WebDAV conditional write conflict; retry sync",
            );
        if (
            ["LOCK", "UNLOCK"].includes(init.method ?? "") &&
            [405, 501].includes(response.status)
        )
            throw new SyncError(
                "CAPABILITY",
                "WebDAV LOCK/UNLOCK is unavailable; allow these methods through the server and proxy",
            );
        if (response.status === 401 || response.status === 403)
            throw new SyncError(
                "AUTH",
                "WebDAV authentication or permission denied",
            );
        if (
            !response.ok &&
            response.status !== 404 &&
            !(init.method === "MKCOL" && response.status === 405)
        )
            throw new SyncError(
                "HTTP",
                `WebDAV ${init.method ?? "GET"} failed (${response.status})`,
            );
        return response;
    };
    type File = { bytes: Uint8Array; etag?: string };
    const strong = (etag?: string | null): etag is string =>
        !!etag && /^"[^"\r\n]+"$/.test(etag);
    const readRaw = async (path: string): Promise<File | undefined> => {
        const response = await send(path, {});
        if (response.status === 404) return;
        return {
            bytes: new Uint8Array(await response.arrayBuffer()),
            etag: response.headers.get("ETag") ?? undefined,
        };
    };
    const putRaw = async (
        path: string,
        bytes: Uint8Array,
        headers: Record<string, string>,
    ) => {
        const response = await send(path, {
            method: "PUT",
            body: new Uint8Array(bytes).buffer,
            headers: { "Content-Type": "application/octet-stream", ...headers },
        });
        if (!response.ok)
            throw new SyncError(
                "HTTP",
                `WebDAV PUT failed (${response.status})`,
            );
    };
    const mkdir = async (path: string) => {
        const response = await send(path ? `${path}/` : "", {
            method: "MKCOL",
        });
        if (!response.ok && response.status !== 405)
            throw new SyncError(
                "HTTP",
                `WebDAV MKCOL failed (${response.status}); create the parent directory first`,
            );
    };
    const expectConflict = async (
        action: () => Promise<unknown>,
        message: string,
    ) => {
        try {
            await action();
        } catch (error) {
            if (error instanceof SyncError && error.code === "PRECONDITION")
                return;
            throw error;
        }
        throw new SyncError("CAPABILITY", message);
    };
    const verifyLocks = async (path: string, bytes: Uint8Array) => {
        await withWebDAVLock(send, path, async (condition, assertActive) => {
            await expectConflict(
                () => putRaw(path, bytes, {}),
                "WebDAV LOCK does not exclude writes without a lock token",
            );
            await expectConflict(
                () =>
                    putRaw(path, bytes, {
                        If: "(<urn:uuid:invalid-sync-token>)",
                    }),
                "WebDAV LOCK does not reject invalid lock tokens",
            );
            assertActive();
            await putRaw(path, bytes, { If: condition });
            const file = await readRaw(path);
            assert(
                file && (await hash(file.bytes)) === (await hash(bytes)),
                "WebDAV locked read-back failed",
            );
        });
        // A suspended page must not write with an expired or released token.
        await expectConflict(
            () =>
                putRaw(path, bytes, { If: "(<urn:uuid:invalid-sync-token>)" }),
            "WebDAV LOCK does not reject stale lock tokens on unlocked files",
        );
    };
    const checkCapabilities = async () => {
        await mkdir("");
        const path = `.capability-${crypto.randomUUID()}`;
        const bytes = new TextEncoder().encode("conditional-write-probe");
        await putRaw(path, bytes, { "If-None-Match": "*" });
        const file = await readRaw(path);
        assert(
            file && (await hash(file.bytes)) === (await hash(bytes)),
            "WebDAV read-back failed",
        );
        if (mode === "etag") {
            try {
                if (!strong(file.etag))
                    throw new SyncError(
                        "CAPABILITY",
                        "WebDAV must return a strong ETag; expose ETag through CORS",
                    );
                const conditions: Record<string, string>[] = [
                    { "If-None-Match": "*" },
                    { "If-Match": '"intentionally-wrong-etag"' },
                ];
                for (const headers of conditions) {
                    await expectConflict(
                        () => putRaw(path, bytes, headers),
                        "WebDAV ignores conditional writes",
                    );
                }
                await putRaw(path, bytes, { "If-Match": file.etag });
            } catch (error) {
                if (
                    concurrency !== "auto" ||
                    !(error instanceof SyncError) ||
                    !["CAPABILITY", "PRECONDITION"].includes(error.code)
                )
                    throw error;
                mode = "lock";
            }
        }
        if (mode === "lock") await verifyLocks(path, bytes);
    };
    let verified: Promise<void> | undefined;
    const verify = () => {
        verified ??= checkCapabilities().catch((error) => {
            verified = undefined;
            throw error;
        });
        return verified;
    };
    const checkVersion = async (path: string, expected?: string) => {
        const file = await readRaw(path);
        if (
            expected === undefined
                ? !!file
                : !file || (await hash(file.bytes)) !== expected
        )
            throw new SyncError(
                "PRECONDITION",
                "WebDAV content changed; refresh and retry sync",
            );
        return file;
    };
    return {
        identity: root.href,
        verify,
        async read(path) {
            const file = await readRaw(path);
            if (!file) return;
            if (mode === "etag" && !strong(file.etag)) {
                if (concurrency === "etag")
                    throw new SyncError(
                        "CAPABILITY",
                        "WebDAV must return a strong ETag; expose ETag through CORS",
                    );
                mode = "lock";
                verified = undefined;
            }
            return {
                bytes: file.bytes,
                etag: mode === "etag" ? file.etag! : await hash(file.bytes),
            };
        },
        async write(path, bytes, condition) {
            await verify();
            if (mode === "etag") {
                return putRaw(
                    path,
                    bytes,
                    "etag" in condition
                        ? { "If-Match": condition.etag }
                        : { "If-None-Match": "*" },
                );
            }
            await withWebDAVLock(send, path, async (token, assertActive) => {
                await checkVersion(
                    path,
                    "etag" in condition ? condition.etag : undefined,
                );
                assertActive();
                await putRaw(path, bytes, { If: token });
                const readback = await readRaw(path);
                assert(
                    readback &&
                        (await hash(readback.bytes)) === (await hash(bytes)),
                    "WebDAV locked write verification failed",
                );
            });
        },
        async remove(path, condition) {
            await verify();
            if (mode === "etag") {
                await send(path, {
                    method: "DELETE",
                    headers: { "If-Match": condition.etag },
                });
                return;
            }
            await withWebDAVLock(send, path, async (token, assertActive) => {
                const file = await readRaw(path);
                if (!file) return;
                if ((await hash(file.bytes)) !== condition.etag)
                    throw new SyncError(
                        "PRECONDITION",
                        "WebDAV delete version changed",
                    );
                assertActive();
                await send(path, { method: "DELETE", headers: { If: token } });
            });
        },
        mkdir,
    };
}
