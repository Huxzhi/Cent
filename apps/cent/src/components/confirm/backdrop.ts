type BackdropInstance = {
    visible: boolean;
    zIndex?: number;
    modalBackdrop?: boolean;
};

/** 整页共用底层遮罩；小弹窗接管遮罩，使其父页面也变暗而不叠加。 */
export function getConfirmBackdropId(
    instances: Readonly<Record<string, BackdropInstance>>,
): string | undefined {
    const visible = Object.entries(instances)
        .filter(([, instance]) => instance.visible)
        .sort(
            ([, left], [, right]) => (left.zIndex ?? 0) - (right.zIndex ?? 0),
        );
    return (
        visible.findLast(([, instance]) => instance.modalBackdrop)?.[0] ??
        visible[0]?.[0]
    );
}
