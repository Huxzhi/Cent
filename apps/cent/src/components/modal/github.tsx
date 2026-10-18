import { useState } from "react";
import { useIntl } from "@/locale";
import type { AccountingGitHubConfig } from "../../sync/github";
import createConfirmProvider from "../confirm";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

type GitHubEdit = Partial<AccountingGitHubConfig> & {
    check?: (config: AccountingGitHubConfig) => Promise<void>;
};
function GitHubForm({
    edit,
    onCancel,
    onConfirm,
}: {
    edit?: GitHubEdit;
    onCancel?: () => void;
    onConfirm?: (config: AccountingGitHubConfig) => void;
}) {
    const t = useIntl();
    const [config, setConfig] = useState({
        owner: edit?.owner ?? "",
        repo: edit?.repo ?? "",
        token: edit?.token ?? "",
        branch: edit?.branch ?? "main",
        path: edit?.path ?? "cent/repo-v6",
    });
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState("");
    const fields = [
        ["owner", "github-sync-owner", "octocat"],
        ["repo", "github-sync-repo", "cent-data"],
        ["branch", "github-sync-branch", "main"],
        ["path", "github-sync-path", "cent/repo-v6"],
        ["token", "github-sync-token", "github_pat_…"],
    ] as const;
    return (
        <form
            className="flex flex-col gap-4 p-4"
            onSubmit={async (event) => {
                event.preventDefault();
                if (checking) return;
                setChecking(true);
                setError("");
                const value = Object.fromEntries(
                    Object.entries(config).map(([key, text]) => [
                        key,
                        text.trim(),
                    ]),
                ) as typeof config;
                try {
                    await edit?.check?.(value);
                    onConfirm?.(value);
                } catch (failure) {
                    setError(
                        failure instanceof Error
                            ? failure.message
                            : String(failure),
                    );
                } finally {
                    setChecking(false);
                }
            }}
        >
            <h2 className="font-semibold">{t("github-sync-title")}</h2>
            <p className="text-xs text-muted-foreground">
                {t("github-sync-help")}
            </p>
            {fields.map(([key, label, placeholder]) => (
                <label
                    key={key}
                    htmlFor={`github-sync-${key}`}
                    className="flex flex-col gap-1 text-sm"
                >
                    {t(label)}
                    <Input
                        id={`github-sync-${key}`}
                        required={key !== "path"}
                        placeholder={placeholder}
                        value={config[key]}
                        type={key === "token" ? "password" : "text"}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={checking}
                        onChange={(event) =>
                            setConfig({ ...config, [key]: event.target.value })
                        }
                    />
                </label>
            ))}
            {error && (
                <p
                    role="alert"
                    className="text-sm text-destructive break-words"
                >
                    {error}
                </p>
            )}
            <div className="flex justify-end gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    disabled={checking}
                    onClick={onCancel}
                >
                    {t("cancel")}
                </Button>
                <Button type="submit" disabled={checking}>
                    {t(checking ? "github-sync-checking" : "confirm")}
                </Button>
            </div>
        </form>
    );
}
export const [GitHubAuthProvider, showGitHubAuth] = createConfirmProvider<
    GitHubEdit,
    AccountingGitHubConfig
>(GitHubForm, {
    dialogTitle: "github-sync-title",
    dialogModalClose: true,
    contentClassName: "w-[380px] max-h-[85dvh] z-[2]",
    fade: true,
});
