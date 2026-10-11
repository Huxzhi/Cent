import { zodResolver } from "@hookform/resolvers/zod";
import { Collapsible } from "radix-ui";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useStore } from "zustand";
import { DefaultCurrencies } from "@/api/currency/currencies";
import { useIntl } from "@/locale";
import { accountingStore } from "@/store/accounting";
import { Button } from "../ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../ui/select";
import type { BillTag } from "./type";

const createFormSchema = (t: any) =>
    z.object({
        name: z
            .string()
            .trim()
            .min(1, { message: t("input-tag-name") })
            .check(
                z.maxLength(50, {
                    message: t("max-name-length-limit", { n: 50 }),
                }),
            ),
        preferCurrency: z.optional(z.string()),
    });

export type EditTag = Omit<BillTag, "id"> & { id?: string };

export const EditTagForm = ({
    edit,
    onConfirm,
    onCancel,
}: {
    edit?: EditTag;
    onConfirm?: (v: EditTag | "delete") => void;
    onCancel?: () => void;
}) => {
    const t = useIntl();
    const accounts = useStore(
        accountingStore,
        (state) => state.current?.data.accounts,
    );
    const quickCurrencies = [
        ...new Set(
            (accounts ?? [])
                .filter((account) => !account.archived)
                .map((account) => account.currency),
        ),
    ].map((id) => {
        const currency = DefaultCurrencies.find((item) => item.id === id);
        return { id, label: currency ? t(currency.labelKey) : id };
    });
    const formSchema = useMemo(() => createFormSchema(t), [t]);
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: { name: "", ...edit },
    });
    const isCreate = edit === undefined;

    const toSubmit = () => {
        const onSubmit = (data: z.infer<typeof formSchema>) => {
            onConfirm?.({ ...data, id: edit?.id });
        };
        form.handleSubmit(onSubmit)();
    };
    return (
        <Form {...form}>
            <div className="w-full h-full flex flex-col">
                <div className="px-4 text-center">
                    {isCreate ? t("add-new-tag") : t("edit-tag")}
                </div>
                <div className="px-4 flex flex-1 flex-col gap-4 overflow-y-auto">
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => {
                            return (
                                <FormItem>
                                    <FormLabel>{t("tag-name")}</FormLabel>
                                    <FormControl>
                                        <Input {...field} maxLength={50} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            );
                        }}
                    ></FormField>
                    <Collapsible.Root className="group">
                        <Collapsible.Trigger>
                            <div className="text-xs opacity-60 flex items-center gap-1">
                                {t("more-tag-settings")}
                                <i className="w-4 h-4 icon-[mdi--chevron-right] transition-all rotate-90 group-[[data-state=closed]]:rotate-0"></i>
                            </div>
                        </Collapsible.Trigger>
                        <Collapsible.CollapsibleContent>
                            <FormField
                                control={form.control}
                                name="preferCurrency"
                                render={({ field }) => {
                                    return (
                                        <FormItem className="flex items-center justify-between">
                                            <div className="max-w-[50%]">
                                                <FormLabel>
                                                    {t("prefer-currency")}
                                                </FormLabel>
                                                <FormDescription>
                                                    {t("prefer-currency-desc")}
                                                </FormDescription>
                                            </div>
                                            <FormControl>
                                                <Select
                                                    value={field.value}
                                                    onValueChange={
                                                        field.onChange
                                                    }
                                                >
                                                    <SelectTrigger>
                                                        <div>
                                                            {quickCurrencies.find(
                                                                (c) =>
                                                                    c.id ===
                                                                    field.value,
                                                            )?.label ??
                                                                t("none")}
                                                        </div>
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {quickCurrencies.length >
                                                        0 ? (
                                                            quickCurrencies.map(
                                                                ({
                                                                    id,
                                                                    label,
                                                                }) => {
                                                                    return (
                                                                        <SelectItem
                                                                            key={
                                                                                id
                                                                            }
                                                                            value={
                                                                                id
                                                                            }
                                                                        >
                                                                            <div>
                                                                                {
                                                                                    label
                                                                                }
                                                                            </div>
                                                                        </SelectItem>
                                                                    );
                                                                },
                                                            )
                                                        ) : (
                                                            <div className="text-sm opacity-60">
                                                                {t(
                                                                    "empty-currency-quick-entries",
                                                                )}
                                                            </div>
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                            </FormControl>
                                        </FormItem>
                                    );
                                }}
                            ></FormField>
                        </Collapsible.CollapsibleContent>
                    </Collapsible.Root>
                </div>
                <div className="flex justify-between items-center px-4">
                    <div>
                        {!isCreate && (
                            <Button
                                variant={"destructive"}
                                onClick={() => {
                                    onConfirm?.("delete");
                                }}
                            >
                                {t("delete")}
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2 items-center">
                        <Button onClick={onCancel}>{t("cancel")}</Button>
                        <Button onClick={toSubmit}>{t("confirm")}</Button>
                    </div>
                </div>
            </div>
        </Form>
    );
};
