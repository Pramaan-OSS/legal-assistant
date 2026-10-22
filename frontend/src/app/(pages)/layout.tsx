"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { ChatHistoryProvider } from "@/app/contexts/ChatHistoryContext";
import { SidebarContext } from "@/app/contexts/SidebarContext";
import { PageChromeContext } from "@/app/contexts/PageChromeContext";
import { AppSidebar } from "@/app/components/shared/AppSidebar";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { HeaderButtonUI, HeaderButtonsUI } from "@/shared/ui/HeaderButtonsUI";
import { cn } from "@/app/lib/utils";

export default function LegalAssistantLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isAuthenticated, authLoading, authError, refreshSession } = useAuth();
    const [hasMounted, setHasMounted] = useState(false);
    useEffect(() => {
        // An outer auth provider may settle before this streamed boundary
        // hydrates. Its first client render must still match the SSR loader.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one hydration transition, independent of auth or streamed content
        setHasMounted(true);
    }, []);
    const router = useRouter();
    const pathname = usePathname();
    const isChatPage =
        /^\/assistant\/chat\/[^/]+\/?$/.test(pathname) ||
        /^\/projects\/[^/]+\/assistant\/chat\/[^/]+\/?$/.test(pathname);
    const [mobileActionsContainer, setMobileActionsContainer] =
        useState<HTMLDivElement | null>(null);

    const [isSidebarOpenDesktop, setIsSidebarOpenDesktop] = useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("sidebarOpen");
            return saved !== null ? saved === "true" : true;
        }
        return true;
    });

    const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
        if (typeof window !== "undefined" && window.innerWidth < 768) {
            return false;
        }
        return true;
    });

    // Persist what is actually on screen. The mount initializer above reads
    // this key back but `isSidebarOpen` starts open on desktop regardless, so
    // storing anything else leaves the restored preference disagreeing with
    // the rendered sidebar and the first toggle click is spent re-syncing
    // them. Remembering a collapsed sidebar across reloads needs the mount
    // path to apply the stored value too — a separate change.
    useEffect(() => {
        if (typeof window !== "undefined" && window.innerWidth >= 768) {
            localStorage.setItem("sidebarOpen", isSidebarOpen.toString());
        }
    }, [isSidebarOpenDesktop]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const handleResize = () => {
            const isSmall = window.innerWidth < 768;
            if (isSmall && isSidebarOpen) setIsSidebarOpen(false);
            else if (!isSmall && !isSidebarOpen)
                setIsSidebarOpen(isSidebarOpenDesktop);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [isSidebarOpen, isSidebarOpenDesktop]);

    const handleSidebarToggle = () => {
        if (window.innerWidth >= 768) {
            setIsSidebarOpenDesktop(!isSidebarOpenDesktop);
            setIsSidebarOpen(!isSidebarOpenDesktop);
        } else {
            setIsSidebarOpen(!isSidebarOpen);
        }
    };

    const handleMobileActionsContainerRef = useCallback(
        (node: HTMLDivElement | null) => {
            setMobileActionsContainer(node);
        },
        [],
    );

    const setSidebarOpen = useCallback((open: boolean) => {
        const isSmall =
            typeof window !== "undefined" && window.innerWidth < 768;
        if (isSmall) {
            if (!open) setIsSidebarOpen(false);
            return;
        }
        setIsSidebarOpen(open);
        setIsSidebarOpenDesktop(open);
    }, []);

    const pageChromeValue = useMemo(
        () => ({ mobileActionsContainer }),
        [mobileActionsContainer],
    );

    const sidebarValue = useMemo(() => ({ setSidebarOpen }), [setSidebarOpen]);

    useEffect(() => {
        if (!authLoading && !isAuthenticated && !authError) {
            router.push("/login");
        }
    }, [authLoading, isAuthenticated, authError, router]);

    if (!hasMounted || authLoading) {
        return <FullScreenLoader />;
    }

    if (authError) return <main className="mx-auto my-12 max-w-md p-6"><p role="alert">{authError}</p><button className="mt-4" onClick={() => { void refreshSession().catch(() => {}); }}>Retry session check</button></main>;
    if (!isAuthenticated) return null;

    return (
        <ChatHistoryProvider>
            <PageChromeContext.Provider value={pageChromeValue}>
                <SidebarContext.Provider value={sidebarValue}>
                    <div className="app-frame">
                        <header className="app-top top"><Link className="wordmark" href="/projects"><i aria-hidden="true"/>Legal Assistant</Link><nav className="crumb" aria-label="Breadcrumb"><Link href="/projects">Projects</Link> / <span>{pathname.startsWith('/settings') ? 'Settings' : pathname.startsWith('/library') ? 'Library' : pathname.startsWith('/assistant') ? 'Assistant' : 'Workspace'}</span></nav><Link href="/settings" aria-label="Open settings">Settings</Link></header>
                        <div className="app-content">
                            <AppSidebar
                                isOpen={isSidebarOpen}
                                onToggle={handleSidebarToggle}
                            />
                            <div className="workspace-island flex-1 flex flex-col min-h-0 md:overflow-hidden relative min-w-0 w-full">
                                {/* Mobile header */}
                                <div
                                    data-slot="mobile-header"
                                    className={cn(
                                        "z-30 flex items-center gap-3 overflow-visible px-4 md:hidden",
                                        isChatPage
                                            ? "pointer-events-none fixed inset-x-0 top-0 bg-transparent pb-2 pt-3"
                                            : "relative shrink-0 pb-2 pt-3",
                                    )}
                                >
                                    <HeaderButtonsUI
                                        className={cn(
                                            "pointer-events-auto",
                                            // Only the chat page floats this
                                            // bar over scrolling content.
                                            isChatPage && "backdrop-blur-2xl",
                                        )}
                                    >
                                        <HeaderButtonUI
                                            iconOnly
                                            onClick={handleSidebarToggle}
                                            title="Open sidebar"
                                            aria-label="Open sidebar"
                                        >
                                            <PanelLeft className="h-4 w-4" />
                                        </HeaderButtonUI>
                                    </HeaderButtonsUI>
                                    <div
                                        ref={handleMobileActionsContainerRef}
                                        className="pointer-events-auto ml-auto flex min-w-0 flex-1 items-center justify-end"
                                    />
                                </div>
                                <main className="view flex h-full w-full flex-1 flex-col overflow-y-auto md:overflow-hidden">
                                    {children}
                                </main>
                            </div>
                        </div>
                    </div>
                </SidebarContext.Provider>
            </PageChromeContext.Provider>
        </ChatHistoryProvider>
    );
}
