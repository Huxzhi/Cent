import { useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useShallow } from "zustand/shallow";
import {
    getSelectedSyncEndpoint,
    SYNC_ENDPOINTS,
    type SyncEndpoint,
} from "@/api/storage/selection";
import {
    AppDownloadIcons,
    useLoginAppDownloadPlatforms,
} from "@/components/app-download";
import { isCancelError } from "@/components/confirm/state";
import { useIntl } from "@/locale";
import { isMeasurementEnabled, measure } from "@/measurement";
import { useIsLogin, useUserStore } from "@/store/user";

const loaded = import("@/api/storage");

const loadStorageAPI = async () => {
    const lib = await loaded;
    return lib.StorageAPI;
};

async function startLogin(method: SyncEndpoint) {
    try {
        const StorageAPI = await loadStorageAPI();
        await StorageAPI.loginWith(method);
    } catch (error) {
        if (!isCancelError(error)) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }
}

const secondaryButtonStyle = `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 h-9 px-4 py-2 w-full`;

const betaClassName = `relative after:content-['beta'] after:rounded after:bg-yellow-400 after:px-[2px] after:text-[8px] after:block after:absolute after:top-0 after:right-0 after:translate-x-[calc(50%)]`;

let loginMethodMeasured = false;

function isLoginMethod(value: string): value is SyncEndpoint {
    return (SYNC_ENDPOINTS as readonly string[]).includes(value);
}

export default function Login() {
    const t = useIntl();
    const isLogin = useIsLogin();
    const selected = getSelectedSyncEndpoint();
    const [loading] = useUserStore(
        useShallow((state) => {
            return [state.loading];
        }),
    );
    useEffect(() => {
        if (!selected || !isLogin || loginMethodMeasured) return;
        loginMethodMeasured = true;
        void loadStorageAPI()
            .then((StorageAPI) => {
                const method = StorageAPI.type;
                if (isLoginMethod(method)) {
                    measure("login_method_used", { method });
                }
            })
            .catch(() => {});
    }, [isLogin, selected]);
    if (selected) {
        return null;
    }
    return createPortal(
        <div className="fixed z-[1] top-0 right-0 w-screen h-screen overflow-hidden">
            <div className="absolute w-full h-full bg-[rgba(0,0,0,0.5)] z-[-1]"></div>
            <div className="w-full h-full flex justify-center items-center">
                <div className="bg-background w-[350px] max-w-[calc(100vw-2rem)] h-[660px] max-h-[calc(100dvh-2rem)] flex flex-col gap-4 items-center rounded-lg overflow-y-auto">
                    <Guide />
                    <div className="min-h-20 h-fit flex flex-col gap-4">
                        <div className="text-center">
                            <h2 className="font-semibold">
                                {t("choose-sync-method")}
                            </h2>
                            <p className="text-xs text-muted-foreground mt-1 max-w-64">
                                {t("choose-sync-method-tip")}
                            </p>
                        </div>
                        {loading ? (
                            <div>
                                <i className="icon-[mdi--loading] animate-spin"></i>
                                {t("login")}
                            </div>
                        ) : (
                            <>
                                {/* Web DAV */}
                                <div>
                                    <button
                                        type="button"
                                        className={`${secondaryButtonStyle} ${betaClassName}`}
                                        aria-label="WebDAV"
                                        onClick={() =>
                                            void startLogin("webdav")
                                        }
                                    >
                                        <i className="icon-[mdi--floppy-disk]"></i>
                                        <div className="flex-1">WebDAV</div>
                                    </button>
                                </div>
                                <div>
                                    <button
                                        type="button"
                                        className={secondaryButtonStyle}
                                        aria-label="GitHub"
                                        onClick={() =>
                                            void startLogin("github")
                                        }
                                    >
                                        <i className="icon-[mdi--github]"></i>
                                        <div className="flex-1">GitHub</div>
                                    </button>
                                </div>
                                {/* Offline */}
                                <div className="pb-4">
                                    <button
                                        type="button"
                                        className={`${secondaryButtonStyle} !w-full`}
                                        onClick={() =>
                                            void startLogin("offline")
                                        }
                                    >
                                        <i className="icon-[mdi--local]"></i>
                                        <div className="flex-1">
                                            {t("offline-mode")}
                                        </div>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                    {isMeasurementEnabled() && (
                        <p className="px-6 pb-4 text-center text-[10px] leading-relaxed text-foreground/50">
                            {t("login-agreement-prefix")}{" "}
                            <a
                                className="underline hover:text-foreground/80"
                                href="https://linkai.work/cent/terms"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t("terms-of-use")}
                            </a>{" "}
                            {t("login-agreement-conjunction")}{" "}
                            <a
                                className="underline hover:text-foreground/80"
                                href="https://linkai.work/cent/privacy"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t("privacy-policy")}
                            </a>
                            {t("login-agreement-suffix")}
                        </p>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}

function Guide() {
    const t = useIntl();
    const platforms = useLoginAppDownloadPlatforms();

    return (
        <div
            className={
                "w-full p-4 flex-1 border-b bg-stone-800 text-white flex flex-col items-center justify-center gap-3 relative"
            }
        >
            <h1 className="text-3xl font-bold">{t("APP_NAME")}</h1>
            <p className="text-sm text-center">{t("app-introduce")}</p>
            <div className="text-xs opacity-60">{t("pwa-install-tip")}</div>
            <div className="absolute bottom-4 left-4 flex justify-center">
                <AppDownloadIcons variant="login" platforms={platforms} />
            </div>
            <a
                className="absolute bottom-4 right-4 text-xs opacity-60 underline"
                target="_blank"
                href="https://glink25.github.io/post/Cent---%E4%BD%A0%E5%8F%AF%E8%83%BD%E5%8F%AA%E9%9C%80%E8%A6%81%E4%B8%80%E4%B8%AA%E8%AE%B0%E8%B4%A6%E8%BD%AF%E4%BB%B6/"
                rel="noopener"
            >
                {t("see-introduce")}
            </a>
        </div>
    );
}
