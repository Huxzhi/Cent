import { SyncError } from "../../types";

export type DAVRequest = (path: string, init: RequestInit) => Promise<Response>;

/** A finite server lock fences writes even if the browser is suspended or closes. */
export async function withWebDAVLock<T>(
    send: DAVRequest,
    path: string,
    action: (condition: string, assertActive: () => void) => Promise<T>,
): Promise<T> {
    const started = Date.now();
    const response = await send(path, {
        method: "LOCK",
        headers: {
            "Content-Type": "application/xml; charset=utf-8",
            Depth: "0",
            Timeout: "Second-120",
        },
        body: '<?xml version="1.0"?><d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockinfo>',
    });
    if (!response.ok)
        throw new SyncError("CAPABILITY", "WebDAV LOCK is unavailable");
    let token = response.headers.get("Lock-Token")?.trim();
    let timeout = response.headers.get("Timeout")?.trim();
    if ((!token || !timeout) && typeof DOMParser !== "undefined") {
        const xml = new DOMParser().parseFromString(
            await response.text(),
            "application/xml",
        );
        if (!xml.getElementsByTagName("parsererror").length) {
            const active = Array.from(
                xml.getElementsByTagNameNS("DAV:", "activelock"),
            ).find(
                (item) =>
                    item.getElementsByTagNameNS("DAV:", "exclusive").length &&
                    item
                        .getElementsByTagNameNS("DAV:", "depth")[0]
                        ?.textContent?.trim() === "0",
            );
            const href = active
                ?.getElementsByTagNameNS("DAV:", "locktoken")[0]
                ?.getElementsByTagNameNS("DAV:", "href")[0]
                ?.textContent?.trim();
            token ??= href ? `<${href}>` : undefined;
            timeout ??= active
                ?.getElementsByTagNameNS("DAV:", "timeout")[0]
                ?.textContent?.trim();
        }
    }
    if (!token || !/^<[^<>\s]+>$/.test(token))
        throw new SyncError(
            "CAPABILITY",
            "WebDAV LOCK must return a valid Lock-Token in its header or XML body",
        );
    const lockToken = token;
    const unlock = () =>
        send(path, {
            method: "UNLOCK",
            headers: { "Lock-Token": lockToken },
        });
    let result: T;
    try {
        const seconds = /^Second-(\d+)$/i.exec(timeout ?? "")?.[1];
        if (!seconds || +seconds <= 0 || +seconds > 120)
            throw new SyncError(
                "CAPABILITY",
                "WebDAV LOCK must grant a finite timeout of at most 120 seconds",
            );
        const assertActive = () => {
            if (Date.now() >= started + +seconds * 1000)
                throw new SyncError(
                    "PRECONDITION",
                    "WebDAV lock expired; retry sync",
                );
        };
        assertActive();
        result = await action(`(${lockToken})`, assertActive);
    } catch (error) {
        // Preserve the write failure, including expiration or an uncertain response.
        await unlock().catch(() => {});
        throw error;
    }
    await unlock();
    return result;
}
