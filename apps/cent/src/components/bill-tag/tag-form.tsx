import createConfirmProvider from "../confirm";
import { EditTagForm } from "./tag";

export const [EditTagProvider, showEditTag] = createConfirmProvider(
    EditTagForm,
    {
        dialogTitle: "edit-tag",
        dialogModalClose: false,
        fade: true,
        swipe: false,
        contentClassName: "w-[350px] h-[480px] max-h-[55vh] py-4",
    },
);
