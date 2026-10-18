import type { StateVersion } from "../types";

/** Detached version of one database snapshot; never another persisted counter. */
export const stateVersion = ({
    writerSeq,
    repoSeq,
}: StateVersion): StateVersion => ({
    writerSeq,
    repoSeq,
});

export const isStateVersion = (value: unknown): value is StateVersion => {
    if (!value || typeof value !== "object") return false;
    const version = value as StateVersion;
    return (
        Number.isSafeInteger(version.writerSeq) &&
        version.writerSeq >= 0 &&
        Number.isSafeInteger(version.repoSeq) &&
        version.repoSeq >= 0
    );
};

export const sameStateVersion = (left: StateVersion, right: StateVersion) =>
    left.writerSeq === right.writerSeq && left.repoSeq === right.repoSeq;
