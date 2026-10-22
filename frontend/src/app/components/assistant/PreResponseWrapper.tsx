"use client";

import type { ReactNode } from "react";
import { PreResponseWrapperUI } from "@/shared/ui/PreResponseWrapperUI";

export function PreResponseWrapper({
    children,
    stepCount,
    shouldMinimize,
    isStreaming,
    forceOpen = false,
    hasError = false,
}: {
    children: ReactNode;
    stepCount: number;
    shouldMinimize: boolean;
    isStreaming: boolean;
    forceOpen?: boolean;
    hasError?: boolean;
}) {
    return (
        <PreResponseWrapperUI
            stepCount={stepCount}
            shouldMinimize={shouldMinimize}
            isStreaming={isStreaming}
            forceOpen={forceOpen}
            hasError={hasError}
        >
            {children}
        </PreResponseWrapperUI>
    );
}
