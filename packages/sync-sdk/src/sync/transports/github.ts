import { type RemoteFile, type RemoteTransport, SyncError } from "../../types";
import { assert } from "../../utils/codec";

export interface GitHubOptions {
    owner: string;
    repo: string;
    token: string;
    /** Existing branch; initialize a new repository with a README first. */
    branch?: string;
    /** Directory of this isolated dataset inside the repository. */
    path?: string;
    fetch?: typeof fetch;
}
export interface GitHubTransport extends RemoteTransport {
    /** Read-only check of repository access and branch existence. */
    check(): Promise<void>;
    listDirectories(path?: string): Promise<string[]>;
}
interface Entry {
    path: string;
    sha: string;
    type: "blob" | "tree" | "commit";
    mode: string;
}
const shaOf = (value: unknown): string => {
    assert(
        typeof value === "string" && /^[a-f0-9]{40}$/.test(value),
        "Invalid GitHub object SHA",
    );
    return value;
};
const hasControl = (value: string, includeSpace = false) =>
    Array.from(value).some(
        (c) =>
            c.charCodeAt(0) < (includeSpace ? 33 : 32) ||
            c.charCodeAt(0) === 127,
    );
function safePath(path: string, empty = false) {
    assert(
        (empty && path === "") ||
            (path.length > 0 &&
                path
                    .split("/")
                    .every(
                        (part) =>
                            !!part &&
                            part !== "." &&
                            part !== ".." &&
                            !hasControl(part) &&
                            !/[\\%?#]/.test(part),
                    )),
        "Unsafe remote path",
    );
    return path;
}
function base64(bytes: Uint8Array) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
}
/** Git Database API transport. Every write creates a single-parent commit and
 * publishes with force:false; a concurrent branch advance causes a safe retry. */
export function createGitHubTransport(options: GitHubOptions): GitHubTransport {
    assert(
        /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(options.owner) &&
            /^[A-Za-z0-9_.-]+$/.test(options.repo) &&
            ![".", ".."].includes(options.repo),
        "Invalid GitHub repository",
    );
    assert(
        !!options.token.trim() && !/[\r\n]/.test(options.token),
        "GitHub token is required",
    );
    const branch = options.branch ?? "main";
    assert(
        !!branch &&
            !hasControl(branch, true) &&
            !/[~^:?*[\\]/.test(branch) &&
            !branch.includes("..") &&
            !branch.includes("@{") &&
            branch !== "@" &&
            branch
                .split("/")
                .every(
                    (p) =>
                        !!p &&
                        !p.startsWith(".") &&
                        !p.endsWith(".") &&
                        !p.endsWith(".lock"),
                ),
        "Invalid GitHub branch",
    );
    const root = safePath(options.path ?? "", true);
    const target = (path: string, empty = false) =>
        [root, safePath(path, empty)].filter(Boolean).join("/");
    const repo = `https://api.github.com/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;
    const ref = `heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
    const request = options.fetch ?? globalThis.fetch.bind(globalThis);
    const send = async (path: string, method = "GET", body?: unknown) => {
        let response: Response;
        try {
            response = await request(`${repo}${path}`, {
                method,
                cache: "no-store",
                redirect: "error",
                headers: {
                    Accept: "application/vnd.github+json",
                    Authorization: `Bearer ${options.token}`,
                    "X-GitHub-Api-Version": "2026-03-10",
                    ...(body === undefined
                        ? {}
                        : { "Content-Type": "application/json" }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
        } catch {
            throw new SyncError(
                "NETWORK",
                "GitHub request failed; check network connectivity",
            );
        }
        if (
            response.status === 429 ||
            (response.status === 403 &&
                (response.headers.get("X-RateLimit-Remaining") === "0" ||
                    response.headers.has("Retry-After")))
        )
            throw new SyncError(
                "RATE_LIMIT",
                "GitHub API rate limit reached; retry later",
            );
        if (response.status === 401 || response.status === 403)
            throw new SyncError(
                "AUTH",
                "GitHub access denied; grant this repository Contents read and write permission",
            );
        return response;
    };
    const json = async (path: string, method = "GET", body?: unknown) => {
        const response = await send(path, method, body);
        if (!response.ok)
            throw new SyncError(
                "HTTP",
                `GitHub ${method} failed (${response.status}); check repository, branch and branch rules`,
            );
        return response.json();
    };
    // Only immutable Git objects are cached. Branch tips are always fetched anew.
    const trees = new Map<string, Promise<Entry[]>>();
    const commits = new Map<string, Promise<string>>();
    const tree = (sha: string) => {
        let job = trees.get(sha);
        if (!job) {
            job = (async () => {
                const data = await json(`/git/trees/${shaOf(sha)}`);
                assert(
                    Array.isArray(data.tree) && !data.truncated,
                    "GitHub directory response is truncated or invalid",
                );
                return data.tree as Entry[];
            })().catch((error) => {
                trees.delete(sha);
                throw error;
            });
            trees.set(sha, job);
            if (trees.size > 256) trees.delete(trees.keys().next().value!);
        }
        return job;
    };
    const tip = async () => {
        const response = await send(`/git/ref/${ref}`);
        if (response.status === 404 || response.status === 409)
            throw new SyncError(
                "REMOTE_NOT_FOUND",
                "GitHub repository or branch not found; check access and initialize the repository with a README",
            );
        if (!response.ok)
            throw new SyncError(
                "HTTP",
                `GitHub branch check failed (${response.status})`,
            );
        const data = await response.json();
        assert(
            data.object?.type === "commit",
            "Invalid GitHub branch reference",
        );
        return shaOf(data.object.sha);
    };
    const commitTree = (sha: string) => {
        let job = commits.get(sha);
        if (!job) {
            job = json(`/git/commits/${shaOf(sha)}`)
                .then((data) => shaOf(data.tree?.sha))
                .catch((error) => {
                    commits.delete(sha);
                    throw error;
                });
            commits.set(sha, job);
            if (commits.size > 128)
                commits.delete(commits.keys().next().value!);
        }
        return job;
    };
    const lookup = async (
        rootTree: string,
        path: string,
    ): Promise<Entry | undefined> => {
        if (!path)
            return { path: "", sha: rootTree, type: "tree", mode: "040000" };
        const parts = path.split("/");
        let current = rootTree;
        for (let i = 0; i < parts.length; i++) {
            const entry = (await tree(current)).find(
                (e) => e.path === parts[i],
            );
            if (!entry) return undefined;
            shaOf(entry.sha);
            if (i === parts.length - 1) return entry;
            assert(
                entry.type === "tree",
                "GitHub path crosses a file or submodule",
            );
            current = entry.sha;
        }
    };
    const fileEntry = (entry?: Entry) => {
        assert(
            !entry ||
                (entry.type === "blob" &&
                    ["100644", "100755"].includes(entry.mode)),
            "GitHub target is a directory, symbolic link or submodule",
        );
        return entry;
    };
    const check = async () => {
        const metadata = await json("");
        if (metadata.permissions?.push === false)
            throw new SyncError(
                "AUTH",
                "GitHub repository is read-only for this token",
            );
        await commitTree(await tip());
    };
    const mutate = async (
        path: string,
        bytes: Uint8Array | undefined,
        condition: { etag: string } | { create: true },
    ) => {
        const fullPath = target(path);
        assert(
            !bytes || bytes.length <= 100 * 1024 * 1024,
            "GitHub blob exceeds 100 MiB",
        );
        let blob: string | undefined;
        for (let attempt = 0; attempt < 8; attempt++) {
            const parent = await tip();
            const baseTree = await commitTree(parent);
            const old = fileEntry(await lookup(baseTree, fullPath));
            if (!bytes && !old) return;
            if ("etag" in condition ? old?.sha !== condition.etag : !!old)
                throw new SyncError(
                    "PRECONDITION",
                    "GitHub conditional write conflict; retry sync",
                );
            if (bytes)
                blob ??= shaOf(
                    (
                        await json("/git/blobs", "POST", {
                            content: base64(bytes),
                            encoding: "base64",
                        })
                    ).sha,
                );
            if (bytes && old?.sha === blob) return;
            const nextTree = shaOf(
                (
                    await json("/git/trees", "POST", {
                        base_tree: baseTree,
                        tree: [
                            {
                                path: fullPath,
                                mode: "100644",
                                type: "blob",
                                sha: bytes ? blob : null,
                            },
                        ],
                    })
                ).sha,
            );
            const nextCommit = shaOf(
                (
                    await json("/git/commits", "POST", {
                        message: bytes
                            ? `sync: ${fullPath}`
                            : `sync: remove ${fullPath}`,
                        tree: nextTree,
                        parents: [parent],
                    })
                ).sha,
            );
            const published = await send(`/git/refs/${ref}`, "PATCH", {
                sha: nextCommit,
                force: false,
            });
            if (published.ok) return;
            // Retry only an actual competing branch advance, not branch protection/validation failures.
            if (
                [409, 422].includes(published.status) &&
                (await tip()) !== parent
            )
                continue;
            throw new SyncError(
                "HTTP",
                `GitHub publication failed (${published.status}); check branch rules and write permission`,
            );
        }
        throw new SyncError(
            "PRECONDITION",
            "GitHub branch is busy; retry sync later",
        );
    };
    return {
        identity: `github://${options.owner.toLowerCase()}/${options.repo.toLowerCase()}/${encodeURIComponent(branch)}/${root.split("/").map(encodeURIComponent).join("/")}`,
        check,
        verify: check,
        async mkdir(path) {
            target(path, true);
        }, // Git tracks files, not empty directories.
        async listDirectories(path = "") {
            const fullPath = target(path, true);
            const entry = await lookup(await commitTree(await tip()), fullPath);
            if (!entry) return [];
            assert(entry.type === "tree", "GitHub directory is a file");
            return (await tree(entry.sha))
                .filter((e) => e.type === "tree")
                .map((e) => e.path)
                .sort();
        },
        async read(path): Promise<RemoteFile | undefined> {
            const fullPath = target(path);
            const entry = fileEntry(
                await lookup(await commitTree(await tip()), fullPath),
            );
            if (!entry) return undefined;
            const data = await json(`/git/blobs/${entry.sha}`);
            assert(
                data.encoding === "base64" &&
                    data.sha === entry.sha &&
                    typeof data.content === "string",
                "Invalid GitHub blob response",
            );
            let bytes: Uint8Array;
            try {
                bytes = Uint8Array.from(
                    atob(data.content.replace(/\s/g, "")),
                    (c) => c.charCodeAt(0),
                );
            } catch {
                throw new SyncError(
                    "INVALID_DATA",
                    "Invalid GitHub blob encoding",
                );
            }
            assert(
                bytes.length === data.size,
                "Incomplete GitHub blob response",
            );
            return { bytes, etag: entry.sha };
        },
        write(path, bytes, condition) {
            return mutate(path, bytes, condition);
        },
        remove(path, condition) {
            return mutate(path, undefined, condition);
        },
    };
}
