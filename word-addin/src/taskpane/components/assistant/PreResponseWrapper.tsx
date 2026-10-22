import React from "react";
import { PreResponseWrapperUI } from "@legal-assistant/pre-response-wrapper-ui";

/**
 * Maps the Word pane's activity state into the shared pre-response UI.
 */
export function PreResponseWrapper({
  children,
  stepCount,
  shouldMinimize,
  isStreaming,
  hasError = false,
}: {
  children: React.ReactNode;
  stepCount: number;
  shouldMinimize: boolean;
  isStreaming: boolean;
  hasError?: boolean;
}): React.ReactElement {
  return (
    <PreResponseWrapperUI
      stepCount={stepCount}
      shouldMinimize={shouldMinimize}
      isStreaming={isStreaming}
      hasError={hasError}
    >
      {children}
    </PreResponseWrapperUI>
  );
}
