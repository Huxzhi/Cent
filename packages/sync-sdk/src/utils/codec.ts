import { gunzipSync, gzipSync } from "fflate";
import { SyncError } from "../types";
export function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new SyncError("INVALID_DATA", message);
}

export function canonical(value: unknown): string {
    if (
        value === null ||
        typeof value === "boolean" ||
        typeof value === "string"
    )
        return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value))
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${Array.from(value, canonical).join(",")}]`;
    assert(
        typeof value === "object" &&
            value !== null &&
            Object.getPrototypeOf(value) === Object.prototype,
        "Only JSON values can be stored",
    );
    return `{${Object.keys(value)
        .sort()
        .map(
            (key) =>
                `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
        )
        .join(",")}}`;
}

export const encode = (value: unknown) =>
    new TextEncoder().encode(canonical(value));

export const decode = (value: Uint8Array): unknown =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value));

export async function hash(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(bytes).buffer,
    );
    return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
/** Deterministic compressed JSON, with no record or sync protocol knowledge. */
export const encodeCompressed = (value: unknown) =>
    gzipSync(encode(value), { mtime: 0 });
export const decodeCompressed = (bytes: Uint8Array): unknown =>
    decode(gunzipSync(bytes));
