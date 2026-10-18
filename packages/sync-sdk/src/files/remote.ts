import { CHUNK_SIZE, chunkKey, chunkStart, publishedSeq } from "../store/entry";
import { identifier, sequence } from "../store/validation";
import {
    type ChunkRef,
    type Manifest,
    type RemoteTransport,
    SyncError,
} from "../types";
import { assert, canonical, decode, encode, hash } from "../utils/codec";
export const emptyManifest = (): Manifest => ({
    format: "record-repo",
    version: 4,
    repoSeq: 0,
    files: [],
    retired: [],
});
export const chunkPath = (
    ref: Pick<ChunkRef, "writerId" | "fromSeq" | "hash">,
) =>
    "chunks/" +
    ref.writerId +
    "-" +
    String(ref.fromSeq).padStart(6, "0") +
    "-" +
    ref.hash.slice(7) +
    ".json.gz";
const safeChunkPath = (path: unknown) =>
    typeof path === "string" &&
    /^chunks\/[A-Za-z0-9_.-]+-[0-9]+-[a-f0-9]{64}\.json\.gz$/.test(path);
export function validateManifest(manifest: Manifest) {
    assert(
        manifest?.format === "record-repo" &&
            manifest.version === 4 &&
            sequence(manifest.repoSeq) &&
            Array.isArray(manifest.files) &&
            Array.isArray(manifest.retired),
        "Invalid repository manifest",
    );
    assert(
        manifest.name === undefined ||
            (typeof manifest.name === "string" && !!manifest.name.trim()),
        "Invalid repository name",
    );
    const keys = new Set<string>();
    const paths = new Set<string>();
    const publications = new Map<number, string>();
    let latest = 0;
    for (const ref of manifest.files) {
        assert(
            ref &&
                identifier(ref.writerId) &&
                sequence(ref.fromSeq) &&
                ref.fromSeq > 0 &&
                chunkStart(ref.fromSeq) === ref.fromSeq &&
                sequence(ref.toSeq) &&
                ref.toSeq >= ref.fromSeq &&
                ref.toSeq - ref.fromSeq < CHUNK_SIZE &&
                sequence(ref.repoSeq) &&
                ref.repoSeq > 0 &&
                ref.repoSeq <= manifest.repoSeq &&
                /^sha256:[a-f0-9]{64}$/.test(ref.hash) &&
                safeChunkPath(ref.file) &&
                ref.file === chunkPath(ref),
            "Invalid chunk reference",
        );
        assert(
            !keys.has(chunkKey(ref)) && !paths.has(ref.file),
            "Duplicate chunk reference",
        );
        assert(
            !publications.has(ref.repoSeq) ||
                publications.get(ref.repoSeq) === ref.writerId,
            "Repository version belongs to multiple writers",
        );
        publications.set(ref.repoSeq, ref.writerId);
        keys.add(chunkKey(ref));
        paths.add(ref.file);
        latest = Math.max(latest, ref.repoSeq);
    }
    assert(
        latest === manifest.repoSeq,
        "Manifest omits its latest publication",
    );
    for (const retired of manifest.retired) {
        assert(
            retired &&
                safeChunkPath(retired.file) &&
                /^sha256:[a-f0-9]{64}$/.test(retired.hash) &&
                retired.file.endsWith(
                    "-" + retired.hash.slice(7) + ".json.gz",
                ) &&
                sequence(retired.retiredAt) &&
                !paths.has(retired.file),
            "Invalid or live retired file",
        );
        paths.add(retired.file);
    }
}
/** A logical chunk may advance, but a confirmed range must never disappear or regress. */
export function assertManifestAdvance(
    previous: Manifest | undefined,
    next: Manifest,
) {
    validateManifest(next);
    if (!previous) return;
    if (next.repoSeq < previous.repoSeq)
        throw new SyncError(
            "REMOTE_HISTORY_LOST",
            "Repository progress is behind confirmed local progress",
        );
    const refs = new Map(next.files.map((ref) => [chunkKey(ref), ref]));
    for (const old of previous.files) {
        const current = refs.get(chunkKey(old));
        if (
            !current ||
            current.toSeq < old.toSeq ||
            current.repoSeq < old.repoSeq
        )
            throw new SyncError(
                "REMOTE_HISTORY_LOST",
                "Confirmed chunk history is missing",
            );
        assert(
            canonical(current) === canonical(old) ||
                (current.toSeq > publishedSeq(previous, old.writerId) &&
                    current.repoSeq > previous.repoSeq),
            "Confirmed repository history changed",
        );
    }
    const oldKeys = new Set(previous.files.map(chunkKey));
    for (const ref of next.files)
        if (!oldKeys.has(chunkKey(ref)))
            assert(
                ref.repoSeq > previous.repoSeq &&
                    ref.toSeq > publishedSeq(previous, ref.writerId),
                "New chunk does not advance writer progress",
            );
    for (const writer of new Set(previous.files.map((ref) => ref.writerId)))
        assert(
            publishedSeq(next, writer) >= publishedSeq(previous, writer),
            "Writer progress regressed",
        );
}
export async function readManifest(
    remote: RemoteTransport,
): Promise<{ value: Manifest; etag?: string }> {
    const file = await remote.read("manifest.json");
    if (!file) return { value: emptyManifest() };
    const value = decode(file.bytes) as Manifest;
    validateManifest(value);
    return { value, etag: file.etag };
}
export async function saveManifest(
    remote: RemoteTransport,
    manifest: Manifest,
    etag?: string,
) {
    validateManifest(manifest);
    await remote.write(
        "manifest.json",
        encode(manifest),
        etag === undefined ? { create: true } : { etag },
    );
}
export async function readChunkFile(remote: RemoteTransport, ref: ChunkRef) {
    const file = await remote.read(ref.file);
    if (!file) throw new SyncError("STALE_FILE", "Chunk file missing");
    return file.bytes;
}
export async function writeImmutable(
    remote: RemoteTransport,
    path: string,
    bytes: Uint8Array,
) {
    const digest = await hash(bytes);
    try {
        await remote.write(path, bytes, { create: true });
    } catch (error) {
        if (!(error instanceof SyncError) || error.code !== "PRECONDITION")
            throw error;
    }
    const readback = await remote.read(path);
    assert(
        readback && (await hash(readback.bytes)) === digest,
        "Uploaded file verification failed",
    );
}
