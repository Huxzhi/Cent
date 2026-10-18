import {
    createWebDAVTransport,
    type RemoteTransport,
    SyncError,
} from "@glink25/sync-sdk";
import type { WebDAVEdit } from "../components/modal/web-dav";
import { bookFolderName, isBookFolder } from "./book-folder";

function createDAVFetch(auth: WebDAVEdit): typeof fetch {
    return async (input, init) => {
        if (!auth.proxy) return fetch(input, init);
        const proxy = new URL(auth.proxy);
        proxy.searchParams.set("url", input.toString());
        const method = init?.method ?? "GET";
        if (proxy.searchParams.has("method") && method !== "POST") {
            proxy.searchParams.set("method", method);
            return fetch(proxy, { ...init, method: "POST" });
        }
        return fetch(proxy, init);
    };
}
const authorization = (auth: WebDAVEdit) =>
    `Basic ${btoa(Array.from(new TextEncoder().encode(`${auth.username}:${auth.password}`), (b) => String.fromCharCode(b)).join(""))}`;

async function withDAVErrors<T>(action: () => Promise<T>): Promise<T> {
    try {
        return await action();
    } catch (error) {
        if (
            error instanceof SyncError &&
            error.code === "CAPABILITY" &&
            error.message.includes("WebDAV LOCK")
        ) {
            throw new SyncError(
                "CAPABILITY",
                "WebDAV 已尝试不依赖强 ETag 的兼容方式。请确认 OpenList 和代理允许 LOCK/UNLOCK，并转发 If、Lock-Token、Timeout 请求头；锁信息需在响应头或 XML 正文中返回。",
            );
        }
        throw error;
    }
}

/** Read-only authentication check; publication capabilities are verified on first push. */
export async function checkAccountingWebDAVConfig(auth: WebDAVEdit) {
    const request = createDAVFetch(auth);
    const remote = createWebDAVTransport({ url: auth.remote, fetch: request });
    let response: Response;
    try {
        response = await request(remote.identity, {
            method: "PROPFIND",
            headers: {
                Authorization: authorization(auth),
                Depth: "0",
                "Content-Type": "application/xml",
            },
            body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
            cache: "no-store",
            redirect: "error",
        });
    } catch {
        throw new Error("连接 WebDAV 失败，请检查网络、服务地址和 CORS 配置。");
    }
    if (response.status === 401 || response.status === 403)
        throw new Error("WebDAV 鉴权失败，请检查用户名、密码和目录权限。");
    if (!response.ok)
        throw new Error(`WebDAV 目录检查失败（${response.status}）。`);
    return true;
}

/** The configured directory is the book root; no application/version folders are added. */
export function createAccountingWebDAVRemote(auth: WebDAVEdit) {
    const root = new URL(`${auth.remote.replace(/\/+$/, "")}/`);
    const fetchDAV = createDAVFetch(auth);
    const config = {
        username: auth.username,
        password: auth.password,
        fetch: fetchDAV,
    };
    let ready: Promise<void> | undefined;
    const ensureRoot = () => {
        ready ??= createWebDAVTransport({ ...config, url: root.href })
            .mkdir("")
            .catch((error) => {
                ready = undefined;
                throw error;
            });
        return ready;
    };
    const transports = new Map<string, RemoteTransport>();
    return {
        provider: "webdav" as const,
        identity: root.href,
        async createBookFolder(name: string) {
            await ensureRoot();
            const stem = bookFolderName(name);
            for (let index = 1; index <= 100; index++) {
                const id = index === 1 ? stem : `${stem}-${index}`;
                let response: Response;
                try {
                    response = await fetchDAV(
                        new URL(`${encodeURIComponent(id)}/`, root),
                        {
                            method: "MKCOL",
                            headers: { Authorization: authorization(auth) },
                            cache: "no-store",
                            redirect: "error",
                        },
                    );
                } catch {
                    throw new Error(
                        "创建 WebDAV 账本目录失败，请检查网络和 CORS 配置。",
                    );
                }
                if (response.status === 201) return id;
                if (response.status === 405 || response.status === 423)
                    continue;
                if (response.status === 401 || response.status === 403)
                    throw new Error(
                        "创建 WebDAV 账本目录失败，请检查账号的目录写入权限。",
                    );
                throw new Error(
                    `创建 WebDAV 账本目录失败（${response.status}）。`,
                );
            }
            throw new Error("同名账本目录过多，请使用其它账本名称。");
        },
        transport(id: string): RemoteTransport {
            if (!isBookFolder(id)) throw new Error("远端账本 ID 无效。");
            const existing = transports.get(id);
            if (existing) return existing;
            const base = createWebDAVTransport({
                ...config,
                url: new URL(`${encodeURIComponent(id)}/`, root).href,
            });
            const transport: RemoteTransport = {
                identity: base.identity,
                read: (path) => withDAVErrors(() => base.read(path)),
                remove: (path, condition) => base.remove!(path, condition),
                verify: () =>
                    withDAVErrors(async () => {
                        await ensureRoot();
                        await base.verify?.();
                    }),
                mkdir: async (path) => {
                    await ensureRoot();
                    await base.mkdir(path);
                },
                write: (path, bytes, condition) =>
                    withDAVErrors(async () => {
                        await ensureRoot();
                        await base.verify?.();
                        await base.write(path, bytes, condition);
                    }),
            };
            transports.set(id, transport);
            return transport;
        },
        async list() {
            await ensureRoot();
            const response = await fetchDAV(root, {
                method: "PROPFIND",
                headers: {
                    Authorization: authorization(auth),
                    Depth: "1",
                    "Content-Type": "application/xml",
                },
                body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
                cache: "no-store",
                redirect: "error",
            });
            if (!response.ok)
                throw new Error(
                    `读取 WebDAV 账本列表失败（${response.status}），请检查鉴权与 CORS。`,
                );
            const xml = new DOMParser().parseFromString(
                await response.text(),
                "application/xml",
            );
            if (xml.getElementsByTagName("parsererror").length)
                throw new Error("WebDAV 目录响应无效。");
            const ids = new Set<string>();
            for (const item of xml.getElementsByTagNameNS("DAV:", "response")) {
                if (!item.getElementsByTagNameNS("DAV:", "collection").length)
                    continue;
                const href = item.getElementsByTagNameNS("DAV:", "href")[0]
                    ?.textContent;
                if (!href) continue;
                const url = new URL(href, root);
                if (
                    url.origin !== root.origin ||
                    !url.pathname.startsWith(root.pathname)
                )
                    continue;
                let id: string;
                try {
                    id = decodeURIComponent(
                        url.pathname
                            .slice(root.pathname.length)
                            .replace(/\/$/, ""),
                    );
                } catch {
                    continue;
                }
                if (id.startsWith("book-") && isBookFolder(id)) ids.add(id);
            }
            return [...ids].sort();
        },
    };
}
