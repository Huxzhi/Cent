import { useStore } from "zustand";
import { accountingStore } from "../store/accounting";
import { getDefaultTimeZone } from "../utils/time";

export function useBookTimeZone() {
    return (
        useStore(accountingStore, (state) => state.current?.data.timeZone) ??
        getDefaultTimeZone()
    );
}
