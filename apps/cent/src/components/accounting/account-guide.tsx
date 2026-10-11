import { useState } from "react";
import type { AccountType } from "../../ledger/accounting";
import { useAccountingLabels } from "./i18n";

export default function AccountGuide({
    initiallyExpanded,
    type,
    showTemplate = false,
}: {
    initiallyExpanded: boolean;
    type: AccountType;
    showTemplate?: boolean;
}) {
    const [expanded, setExpanded] = useState(initiallyExpanded);
    const { t, accountTypes, accountTypeDescriptions } = useAccountingLabels();
    return (
        <details
            className="rounded-md border bg-muted/30 p-3"
            open={expanded}
            onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
            <summary className="cursor-pointer text-sm font-medium">
                {t(
                    showTemplate
                        ? "accounting-template-guide-heading"
                        : "accounting-type-guide",
                    { type: accountTypes[type] },
                )}
            </summary>
            <div className="mt-3 space-y-2 text-sm">
                <p>{accountTypeDescriptions[type]}</p>
                <p className="text-muted-foreground">
                    {t(`accounting-example-${type}`)}
                </p>
                <p className="text-muted-foreground">
                    {t("accounting-guide-pairing")}
                </p>
                {showTemplate && (
                    <div className="space-y-2 border-t pt-2 text-muted-foreground">
                        <p className="font-medium text-foreground">
                            {t("accounting-template-guide-title")}
                        </p>
                        {type === "asset" ? (
                            <>
                                <p>{t("accounting-template-guide-payments")}</p>
                                <p>{t("accounting-template-guide-card")}</p>
                                <p>{t("accounting-template-guide-fixed")}</p>
                            </>
                        ) : (
                            <p>{t(`accounting-template-guide-${type}`)}</p>
                        )}
                    </div>
                )}
            </div>
        </details>
    );
}
