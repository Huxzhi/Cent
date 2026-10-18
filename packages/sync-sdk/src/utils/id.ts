const alphabet =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomId(length: number) {
    let id = "";
    while (id.length < length)
        for (const byte of crypto.getRandomValues(new Uint8Array(length + 2))) {
            // Reject the uneven tail instead of biasing the base62 characters.
            if (byte >= 248) continue;
            id += alphabet[byte % alphabet.length];
            if (id.length === length) return id;
        }
    return id;
}

/** Record IDs can be allocated before writing to build related records. */
export const createId = () => randomId(12);
export const createWriterId = () => randomId(6);
