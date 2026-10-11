import "./utils/shim";
import "@/utils/fetch-proxy";

import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

import { initIntl, intl, LocaleProvider, t } from "./locale/index";
import { measure } from "./measurement";
import { accountingStore } from "./store/accounting";
import { usePreferenceStore } from "./store/preference";
import { register as registerLaunchQueue } from "./utils/launch-queue";
import { lazyWithReload } from "./utils/lazy";
import { registerPWAUpdates } from "./utils/pwa";
import { configureTime } from "./utils/time";

configureTime({
    getTimeZone: () => accountingStore.getState().current?.data.timeZone,
    getLocale: () => intl?.locale,
    translate: t,
});

registerPWAUpdates();

const Rooot = lazyWithReload(() => import("./route"));

measure("app_open");

const lang = usePreferenceStore.getState().locale;
initIntl(lang).then(() => {
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <LocaleProvider>
                <Suspense>
                    <Rooot />
                </Suspense>
            </LocaleProvider>
        </StrictMode>,
    );
});

registerLaunchQueue();
