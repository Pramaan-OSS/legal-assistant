import { act, render, screen, fireEvent } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import LegalAssistantLayout from "./layout";

const state = vi.hoisted(() => ({ loading: true, error: null as string | null, push: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/navigation", () => ({
    usePathname: () => "/projects",
    useRouter: () => ({ push: state.push }),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ authLoading: state.loading, isAuthenticated: !state.loading && !state.error, authError: state.error, refreshSession: state.refresh }),
}));
vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    ChatHistoryProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/components/shared/AppSidebar", () => ({ AppSidebar: () => <aside>Sidebar</aside> }));

it("hydrates the server loading shell even when auth resolved before this boundary", async () => {
    state.loading = true;
    const container = document.createElement("div");
    container.innerHTML = renderToString(<LegalAssistantLayout><p>Workspace</p></LegalAssistantLayout>);
    document.body.append(container);
    // An outer provider can finish its request before this streamed/lazy
    // boundary hydrates, so its context already differs from the SSR snapshot.
    state.loading = false;
    const recoverableError = vi.fn();
    let root!: ReturnType<typeof hydrateRoot>;
    try {
        await act(async () => {
            root = hydrateRoot(container, <LegalAssistantLayout><p>Workspace</p></LegalAssistantLayout>, {
                onRecoverableError: recoverableError,
            });
        });
        expect(container).toHaveTextContent("Workspace");
        expect(recoverableError).not.toHaveBeenCalled();
    } finally {
        await act(async () => root?.unmount());
        container.remove();
    }
});

it("keeps an unsuccessful session check on a retry screen instead of sending the user to login", async () => {
 state.loading=false;state.error="We could not check your session. Try again.";state.push.mockClear();
 const view=render(<LegalAssistantLayout><p>Private workspace</p></LegalAssistantLayout>);
 try{expect(screen.getByRole('alert')).toHaveTextContent('could not check');expect(screen.queryByText('Private workspace')).toBeNull();expect(state.push).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Retry session check'}));expect(state.refresh).toHaveBeenCalledOnce();}finally{view.unmount();state.error=null;}
});
