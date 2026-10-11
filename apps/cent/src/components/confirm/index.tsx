import { VisuallyHidden } from "radix-ui";
import { type ReactNode, useEffect, useMemo } from "react";
import { useIntl as useOriginalIntl } from "react-intl";
import { useShallow } from "zustand/shallow";
import { useIntl } from "@/locale";
import { cn } from "@/utils";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
} from "../ui/dialog";
import { getConfirmBackdropId } from "./backdrop";
import { useGlobalConfirmStore } from "./state"; // 引入上面创建的全局 store

export default function createConfirmProvider<Value, Returned = Value>(
    Form: (props: {
        edit?: Value;
        onCancel?: () => void;
        onConfirm?: (v: Returned) => void;
    }) => ReactNode,
    {
        dialogTitle,
        dialogDescription = dialogTitle,
        dialogModalClose,
        contentClassName,
        fade,
        swipe,
        closeDisabled,
    }: {
        dialogTitle: string | ReactNode;
        dialogDescription?: string | ReactNode;
        dialogModalClose?: boolean;
        contentClassName?: string;
        fade?: boolean;
        swipe?: boolean;
        /** A live predicate used by forms while their save operation is pending. */
        closeDisabled?: () => boolean;
    },
) {
    // 1. 为每个 Provider 实例生成一个唯一的 ID (在闭包中唯一)
    const instanceId = `confirm_${Math.random().toString(36).slice(2, 9)}`;

    function Confirm() {
        const t = useIntl();
        const { messages } = useOriginalIntl();
        const label = (value: string | ReactNode) =>
            typeof value === "string" && value in messages ? t(value) : value;
        // 2. 仅监听属于自己 ID 的那部分状态
        const state = useGlobalConfirmStore(
            useShallow((s) => s.instances[instanceId]),
        );
        // 小弹窗接管唯一遮罩，整页之间继续共用遮罩。
        const backdrop = useGlobalConfirmStore(
            (s) => getConfirmBackdropId(s.instances) === instanceId,
        );
        const layerStyle = useMemo(
            () =>
                state?.zIndex != null
                    ? { zIndex: `${state.zIndex}` }
                    : undefined,
            [state?.zIndex],
        );
        // 3. 组件卸载时清理全局 Store 中的数据，避免内存泄漏
        useEffect(() => {
            return () => useGlobalConfirmStore.getState().remove(instanceId);
        }, []);
        // 如果该实例还未初始化（从未调用过 open），则不渲染
        if (!state) return null;

        const { visible, edit, controller, openId } = state;

        const onCancel = () => {
            if (closeDisabled?.()) return;
            controller?.cancel();
        };

        const onConfirm = (v: Returned) => {
            controller?.resolve(v);
            useGlobalConfirmStore.getState().update(instanceId, {
                visible: false,
                controller: undefined,
            });
        };

        return (
            <Dialog
                key={openId}
                open={visible}
                onOpenChange={(v) => {
                    if (!v) onCancel();
                }}
            >
                <DialogPortal>
                    <DialogOverlay
                        className="fixed inset-0 bg-black/50"
                        style={layerStyle}
                    />
                    <div
                        className="fixed top-0 left-0 w-full h-full flex justify-center items-center pointer-events-none"
                        style={layerStyle}
                    >
                        <DialogContent
                            backdrop={backdrop}
                            fade={fade}
                            swipe={swipe}
                            className={cn(
                                "pointer-events-auto bg-background max-h-[55vh] w-[90vw] max-w-[500px] rounded-md overflow-y-auto",
                                contentClassName,
                            )}
                            onOpenAutoFocus={(e) => {
                                (
                                    document.activeElement as HTMLElement
                                )?.blur?.();
                                e.preventDefault();
                            }}
                            onInteractOutside={(e) => {
                                if (!dialogModalClose || closeDisabled?.())
                                    e.preventDefault();
                            }}
                            onEscapeKeyDown={(e) => {
                                if (closeDisabled?.()) e.preventDefault();
                            }}
                        >
                            <VisuallyHidden.Root>
                                <DialogTitle>{label(dialogTitle)}</DialogTitle>
                                <DialogDescription>
                                    {label(dialogDescription)}
                                </DialogDescription>
                            </VisuallyHidden.Root>
                            <Form
                                edit={edit}
                                onCancel={onCancel}
                                onConfirm={onConfirm}
                            />
                        </DialogContent>
                    </div>
                </DialogPortal>
            </Dialog>
        );
    }

    // 4. 暴露的 open 方法封装了 instanceId
    const confirm = (value?: Value) => {
        const [promise] = useGlobalConfirmStore
            .getState()
            .open<Value, Returned>(instanceId, value, fade);
        return promise;
    };

    const withController = (value?: Value) => {
        const [promise, cancel] = useGlobalConfirmStore
            .getState()
            .open<Value, Returned>(instanceId, value, fade);
        return { promise, cancel };
    };

    return [Confirm, confirm, withController] as const;
}
