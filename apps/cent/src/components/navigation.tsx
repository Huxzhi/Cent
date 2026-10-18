import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { useIntl } from "@/locale";
import { BaseButton } from "./add-button/base";
import { goAddBill } from "./bill-editor";
import { showSettings } from "./settings";

export default function Navigation({
    disabled = false,
}: {
    disabled?: boolean;
} = {}) {
    const t = useIntl();
    const location = useLocation();
    const navigate = useNavigate();

    const currentTab = useMemo(() => {
        return ["/stat", "/", "/search"].find((x) => location.pathname === x);
    }, [location.pathname]);

    const switchTab = (value: "/" | "/stat" | "/search") => {
        navigate(`${value}`);
    };

    return createPortal(
        <div
            className="floating-tab fixed w-screen h-18 flex items-center justify-around sm:h-screen
         sm:w-18 sm:flex-col sm:justify-start z-[0] 
         bottom-[calc(.25rem+var(--safe-area-inset-bottom))]
         sm:top-[var(--safe-area-top)] sm:left-[calc(.25rem+var(--safe-area-inset-left))]"
        >
            {/* search */}
            <button
                disabled={disabled}
                type="button"
                aria-label={t("accounting-nav-search")}
                className={`w-14 h-14 sm:w-10 sm:h-10 cursor-pointer flex items-center justify-center rounded-full shadow-md m-2 transition-all hover:bg-[#9a9ba2] active:bg-[#cdcdd0] dark:hover:bg-[#aba8a5] ${
                    currentTab === "/search"
                        ? "bg-[#cdcdd0] dark:bg-[#918c89]"
                        : "bg-background dark:bg-stone-500"
                }`}
                onClick={() => switchTab("/search")}
            >
                <i className="icon-[mdi--search] size-5"></i>
            </button>

            {/* middle group */}
            <div className="flex items-center rounded-full p-1 bg-background dark:bg-stone-500 w-56 h-14 m-2 shadow-md sm:flex-col sm:w-10 sm:h-50 sm:-order-1">
                <button
                    disabled={disabled}
                    type="button"
                    aria-label={t("accounting-nav-home")}
                    className={`flex-1 h-full w-full transition rounded-full flex items-center justify-center cursor-pointer hover:bg-[#9a9ba2] active:bg-[#cdcdd0] ${
                        currentTab === "/" ? "bg-foreground/20" : ""
                    }`}
                    onClick={() => switchTab("/")}
                >
                    <i className="icon-[mdi--format-align-center] size-5"></i>
                </button>

                <BaseButton
                    disabled={disabled}
                    aria-label={t("accounting-nav-add")}
                    onClick={() => {
                        void goAddBill().catch(() => {});
                    }}
                >
                    <i
                        aria-hidden
                        className="icon-[mdi--add] text-white size-7"
                    />
                </BaseButton>

                <button
                    disabled={disabled}
                    type="button"
                    aria-label={t("accounting-nav-stat")}
                    className={`flex-1 h-full w-full transition-all rounded-full flex items-center justify-center cursor-pointer hover:bg-[#9a9ba2] active:bg-[#cdcdd0] ${
                        currentTab === "/stat" ? "bg-foreground/20" : ""
                    }`}
                    onClick={() => switchTab("/stat")}
                >
                    {/* <div className="transform translate-x-[25%] translate-y-[-25%]"> */}
                    <i className="icon-[mdi--chart-box-outline] size-5"></i>
                    {/* </div> */}
                </button>
            </div>

            {/* settings */}
            <button
                disabled={disabled}
                type="button"
                aria-label={t("accounting-nav-settings")}
                className="w-14 h-14 sm:w-10 sm:h-10 cursor-pointer flex items-center justify-center rounded-full shadow-md m-2 transition-all hover:bg-[#9a9ba2] active:bg-[#cdcdd0] bg-background dark:bg-stone-500 dark:hover:bg-[#aba8a5]"
                onClick={() => {
                    void showSettings().catch(() => {});
                }}
            >
                <i className="icon-[mdi--more-horiz] size-5"></i>
            </button>
        </div>,
        document.body,
    );
}
