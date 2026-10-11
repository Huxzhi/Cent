import { useIntl } from "@/locale";
import Clearable from "../clearable";
import { Button } from "../ui/button";

/** 沿用原搜索页的输入框、清空按钮及回车／按钮提交交互。 */
export default function SearchInput({
    value,
    onValueChange,
    onSearch,
    onClear,
}: {
    value: string;
    onValueChange: (value: string) => void;
    onSearch: () => void;
    onClear: () => void;
}) {
    const t = useIntl();
    return (
        <form
            className="search w-full flex justify-center pt-4"
            onSubmit={(event) => {
                event.preventDefault();
                onSearch();
            }}
        >
            <div className="w-full h-10 shadow-md rounded-sm flex items-center px-4 focus-within:shadow-lg">
                <div className="flex-1 min-w-0">
                    <Clearable
                        visible={Boolean(value.length)}
                        onClear={onClear}
                        clearLabel={t("accounting-search-clear")}
                    >
                        <input
                            value={value}
                            type="text"
                            aria-label={t("accounting-search-input")}
                            placeholder={t("accounting-search-input")}
                            className="w-full min-w-0 bg-transparent outline-none"
                            onChange={(event) =>
                                onValueChange(event.target.value)
                            }
                        />
                    </Clearable>
                </div>
                <Button
                    type="submit"
                    variant="ghost"
                    className="p-3 rounded-md"
                    aria-label={t("accounting-search-submit")}
                >
                    <i className="icon-[mdi--search]" />
                </Button>
            </div>
        </form>
    );
}
