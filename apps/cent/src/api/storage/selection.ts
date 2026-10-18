export const SYNC_ENDPOINT_KEY = "SYNC_ENDPOINT";
export const SYNC_ENDPOINTS = ["webdav", "github", "offline"] as const;
export type SyncEndpoint = (typeof SYNC_ENDPOINTS)[number];

export function getSelectedSyncEndpoint(): SyncEndpoint | undefined {
    const value = localStorage.getItem(SYNC_ENDPOINT_KEY);
    // Old GitHub OAuth credentials do not configure the new SDK adapter.
    if (value === "github" && !localStorage.getItem("github-sync-config"))
        return undefined;
    return SYNC_ENDPOINTS.find((endpoint) => endpoint === value);
}
