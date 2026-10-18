import { toast } from "sonner";
import { ImportPreviewProvider } from "../data-manager/preview-form";
import { GitHubAuthProvider, showGitHubAuth } from "./github";
import { LoadingProvider, loading } from "./loading";
import { PromptProvider, prompt } from "./prompt";
import { showWebDAVAuth, WebDAVAuthProvider } from "./web-dav";

export function ModalProvider() {
    return (
        <>
            <PromptProvider />
            <ImportPreviewProvider />
            <LoadingProvider />
            <WebDAVAuthProvider />
            <GitHubAuthProvider />
        </>
    );
}

const modal = {
    loading,
    prompt,
    webDavAuth: showWebDAVAuth,
    githubAuth: showGitHubAuth,
    toast,
};

export type Modal = typeof modal;

export default modal;
