export class RemoteVersionConflictError extends Error {
    constructor() {
        super("Remote book changed during synchronization");
        this.name = "RemoteVersionConflictError";
    }
}
