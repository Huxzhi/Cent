const forbidden = /[<>:"/\\|?*#%\p{Cc}]/u;
const encoder = new TextEncoder();

/** One decoded directory segment; URLs encode it only at the transport boundary. */
export function isBookFolder(id: string) {
    return (
        !!id &&
        /^[\p{L}\p{N}]/u.test(id) &&
        !forbidden.test(id) &&
        !/[.\s]$/u.test(id) &&
        encoder.encode(id).length <= 240
    );
}

export function bookFolderName(name: string) {
    const clean = name
        .normalize("NFC")
        .trim()
        .replace(new RegExp(forbidden, "gu"), "_")
        .replace(/[.\s]+$/u, "");
    let stem = "";
    for (const character of clean) {
        if (encoder.encode(stem + character).length > 200) break;
        stem += character;
    }
    return `book-${stem.replace(/[.\s]+$/u, "") || "账本"}`;
}
