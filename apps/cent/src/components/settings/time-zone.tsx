import { useId } from "react";
import { useStore } from "zustand";
import { useIntl } from "@/locale";
import { accountingStore } from "../../store/accounting";
import { getDefaultTimeZone } from "../../utils/time";
import { FormError, useFormAction } from "../accounting/shared";

export default function TimeZoneSettingsItem() {
    const id = useId();
    const t = useIntl();
    const { current, busy } = useStore(accountingStore);
    const { error, submitting, run } = useFormAction();
    const value = current?.data.timeZone ?? getDefaultTimeZone();
    const zones = [
        ...new Set([
            "UTC",
            value,
            ...(typeof Intl.supportedValuesOf === "function"
                ? Intl.supportedValuesOf("timeZone")
                : [
                      "Asia/Shanghai",
                      "Asia/Taipei",
                      "Asia/Tokyo",
                      "Europe/London",
                      "America/New_York",
                      "America/Los_Angeles",
                  ]),
        ]),
    ];
    return (
        <div className="w-full px-8 py-2 text-sm">
            <div className="flex justify-between items-center gap-3 font-medium">
                <label htmlFor={id} className="flex items-center gap-2">
                    <i
                        aria-hidden
                        className="icon-[mdi--clock-outline] size-5"
                    />
                    {t("accounting-time-zone")}
                </label>
                <select
                    id={id}
                    className="h-9 max-w-[65%] rounded-md border border-input bg-background px-2 text-xs shadow-xs"
                    value={value}
                    disabled={!current || busy || submitting}
                    onChange={(event) => {
                        const timeZone = event.target.value;
                        void run(() =>
                            accountingStore
                                .getState()
                                .updateData(
                                    (data) => ({ ...data, timeZone }),
                                    Date.now(),
                                ),
                        );
                    }}
                >
                    {zones.map((zone) => (
                        <option key={zone} value={zone}>
                            {zone}
                        </option>
                    ))}
                </select>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
                {t("accounting-time-zone-help")}
            </p>
            <FormError error={error} />
        </div>
    );
}
