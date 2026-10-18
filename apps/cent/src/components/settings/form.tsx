import type { ReactNode } from "react";
import { toast } from "sonner";
import { StorageAPI } from "@/api/storage";
import { SYNC_ENDPOINT_KEY } from "@/api/storage/selection";
import PopupLayout from "@/layouts/popup-layout";
import { useIntl } from "@/locale";
import { ACTIVE_BOOK_KEY } from "@/store/accounting";
import { useUserStore } from "@/store/user";
import { showAccountingBooks } from "../accounting/book-manager";
import TagSettingsItem from "../bill-tag";
import { BookSettings } from "../book";
import Budget from "../budget";
import CurrencySettingsItem from "../currency";
import DataManagerSettingsItem from "../data-manager";
import ScheduledSettingsItems from "../scheduled/settings-item";
import SponsorBanner, { SponsorProvider } from "../sponsor";
import { Button } from "../ui/button";
import WidgetSettings from "../widget";
import AboutSettingsItem, { AdvancedGuideItem } from "./about";
import AccountSettingsItem from "./accounts";
import AgentApiSettingsItem from "./agent-api";
import AssistantSettingsItem from "./assistant";
import LabSettingsItem from "./lab";
import LanguageSettingsItem from "./language";
import MapSettingsItem from "./map-settings";
import PresetSettingsItem from "./preset";
import QuickEntrySettingsItem from "./quick-entry";
import ThemeSettingsItem from "./theme";
import TimeZoneSettingsItem from "./time-zone";
import UserSettingsItem from "./user";
import VoiceSettingsItem from "./voice";

// 复用原设置项的外观；未迁移的操作不能写入旧 Bill 账本。
function PendingBookFeature({ children }: { children: ReactNode }) {
    const t = useIntl();
    return (
        <div
            role="presentation"
            onClickCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toast.info(t("accounting-feature-pending"));
            }}
        >
            {children}
        </div>
    );
}
function UserInfo() {
    const t = useIntl();
    const { id, avatar_url, name, expired } = useUserStore();
    const switchAccount = async () => {
        await StorageAPI.logout();
        localStorage.removeItem(SYNC_ENDPOINT_KEY);
        localStorage.removeItem(ACTIVE_BOOK_KEY);
        location.reload();
    };
    return (
        <div className="flex items-center justify-between gap-2 px-8 py-4">
            <div className="flex-1 flex items-center gap-2 overflow-hidden">
                <img
                    src={avatar_url}
                    alt={`${id}`}
                    className="w-12 h-12 rounded-full border"
                />

                <div className="flex flex-col overflow-hidden">
                    <div className="flex">
                        <div className="font-semibold flex-1 truncate">
                            {name}
                        </div>
                        <div
                            className="px-2 flex-shrink-0"
                            title={t("signed-with", {
                                provider: StorageAPI.name,
                            })}
                        >
                            <div className="text-xs border rounded px-1">
                                {StorageAPI.name}
                            </div>
                        </div>
                    </div>
                    <div className="text-sm opacity-60">{id}</div>
                </div>
            </div>
            <div className="flex items-center gap-2">
                {expired && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            StorageAPI.loginWith(StorageAPI.type);
                        }}
                    >
                        <i className="icon-[mdi--reload]"></i>
                        {t("re-login")}
                    </Button>
                )}
                <Button size="sm" variant="outline" onClick={switchAccount}>
                    {t("switch-account")}
                </Button>
            </div>
        </div>
    );
}

export default function SettingsForm({
    onCancel,
}: {
    onConfirm?: (isEdit: boolean) => void;
    onCancel?: () => void;
}) {
    const t = useIntl();

    const showRelyr = Boolean(import.meta.env.VITE_RELAYR_URL);

    return (
        <PopupLayout
            onBack={onCancel}
            title={t("settings")}
            className="h-full overflow-hidden"
        >
            <div className="divide-y divide-solid flex flex-col overflow-hidden flex-1 min-h-0">
                <UserInfo />
                <div className="flex-1 overflow-y-auto flex flex-col py-4">
                    <SponsorBanner />
                    <div>
                        <div className="text-xs opacity-60 px-8">
                            {t("book-settings")}
                        </div>
                        <div className="flex flex-col divide-y">
                            <BookSettings
                                onOpen={() => {
                                    void showAccountingBooks("books").catch(
                                        () => {},
                                    );
                                }}
                            />
                            <PendingBookFeature>
                                <PresetSettingsItem />
                            </PendingBookFeature>
                            <PendingBookFeature>
                                <WidgetSettings />
                            </PendingBookFeature>
                            <PendingBookFeature>
                                <UserSettingsItem />
                            </PendingBookFeature>
                            <DataManagerSettingsItem />
                        </div>
                    </div>
                    <div>
                        <div className="text-xs opacity-60 px-8">{t("ai")}</div>
                        <div className="flex flex-col divide-y">
                            <PendingBookFeature>
                                <AssistantSettingsItem />
                            </PendingBookFeature>
                            <PendingBookFeature>
                                <AgentApiSettingsItem />
                            </PendingBookFeature>
                            {showRelyr && (
                                <PendingBookFeature>
                                    <QuickEntrySettingsItem />
                                </PendingBookFeature>
                            )}
                            <PendingBookFeature>
                                <VoiceSettingsItem />
                            </PendingBookFeature>
                        </div>
                    </div>
                    <div>
                        <div className="text-xs opacity-60 px-8">
                            {t("billing-functions")}
                        </div>
                        <div className="flex flex-col divide-y">
                            <AccountSettingsItem />
                            <TagSettingsItem />
                            <PendingBookFeature>
                                <Budget />
                            </PendingBookFeature>
                            <PendingBookFeature>
                                <ScheduledSettingsItems />
                            </PendingBookFeature>
                            <CurrencySettingsItem />
                            <TimeZoneSettingsItem />
                        </div>
                    </div>

                    <div>
                        <div className="text-xs opacity-60 px-8">
                            {t("other-settings")}
                        </div>
                        <div className="flex flex-col divide-y">
                            <MapSettingsItem />
                            <LabSettingsItem />
                            <AboutSettingsItem />
                            <ThemeSettingsItem />
                            <LanguageSettingsItem />
                            <AdvancedGuideItem />
                        </div>
                    </div>
                </div>
            </div>
            <SponsorProvider />
        </PopupLayout>
    );
}
