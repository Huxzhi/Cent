import { strFromU8, unzip } from "fflate";
import type { ExportedJSON } from "../../ledger/type";

const BACKUP_JSON_FILE = "backup.json";
const ASSET_PREFIX = "assets/";
const MIME_BY_EXTENSION: Record<string, string> = {
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    json: "application/json",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
};

const unzipAsync = (data: Uint8Array) => {
    return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        unzip(data, (error, files) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(files);
        });
    });
};

const getFileExtension = (fileName: string, fallbackType?: string) => {
    const extension = fileName.split(".").pop()?.trim().toLowerCase();
    if (extension && extension !== fileName.toLowerCase()) {
        return extension;
    }
    const typeExtension = fallbackType?.split("/").pop()?.toLowerCase();
    return typeExtension && typeExtension !== "octet-stream"
        ? typeExtension
        : "bin";
};

const getMimeType = (fileName: string, fallbackType?: string) => {
    if (fallbackType) {
        return fallbackType;
    }
    return (
        MIME_BY_EXTENSION[getFileExtension(fileName)] ??
        "application/octet-stream"
    );
};

const getImportedFileName = (assetPath: string) => {
    return assetPath.split("/").pop() || "asset";
};

const normalizeZipAssetPath = (value: string) => {
    return value.replace(/^\.\//, "");
};

const mapImportImages = async (
    items: ExportedJSON["items"],
    assets: Record<string, Uint8Array>,
) => {
    return await Promise.all(
        items.map(async (item) => {
            if (!item.images?.length) {
                return item;
            }
            const images = await Promise.all(
                item.images.map(async (image) => {
                    if (typeof image !== "string") {
                        return image;
                    }
                    if (
                        image.startsWith(ASSET_PREFIX) ||
                        image.startsWith(`./${ASSET_PREFIX}`)
                    ) {
                        const assetPath = normalizeZipAssetPath(image);
                        const assetData = assets[assetPath];
                        if (!assetData) {
                            throw new Error(
                                `Missing asset in backup: ${assetPath}`,
                            );
                        }
                        const mimeType = getMimeType(assetPath);
                        const blob = new Blob([assetData as any], {
                            type: mimeType,
                        });
                        return new File(
                            [blob],
                            getImportedFileName(assetPath),
                            {
                                type: mimeType,
                            },
                        );
                    }
                    return image;
                }),
            );
            return { ...item, images };
        }),
    );
};

export const processImportFile = async (backupFile: File) => {
    const isZip =
        backupFile.type === "application/zip" ||
        /\.zip$/i.test(backupFile.name);
    if (!isZip) {
        const jsonText = await backupFile.text();
        return JSON.parse(jsonText) as ExportedJSON;
    }

    const zipData = new Uint8Array(await backupFile.arrayBuffer());
    const files = await unzipAsync(zipData);
    const jsonData = files[BACKUP_JSON_FILE];
    if (!jsonData) {
        throw new Error(`Missing ${BACKUP_JSON_FILE} in backup zip`);
    }
    const data = JSON.parse(strFromU8(jsonData)) as ExportedJSON;
    return {
        ...data,
        items: await mapImportImages(data.items, files),
    };
};
