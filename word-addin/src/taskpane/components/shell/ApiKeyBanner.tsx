import React, { useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { getApiKeyStatus, type ApiKeyStatus } from "../../api/legalAssistantApi";

const DISMISS_KEY = "apiKeyBannerDismissed";

// The web app hosts the API-keys settings page; the task pane only links to it.
// Read the substituted value directly — a `typeof process` guard is false in
// the browser and would silently fall through to the default.
const WEB_APP_URL: string =
  process.env.REACT_APP_WEB_APP_URL || "https://legal-assistant.local";

const API_KEYS_PAGE_URL = `${WEB_APP_URL.replace(/\/+$/, "")}/settings/byok`;

/**
 * Open the web app's API-keys page in the system browser. Office's
 * openBrowserWindow is the sanctioned way out of the task-pane webview
 * (window.open is blocked in some hosts); fall back to window.open when the
 * API isn't available (e.g. the hermetic e2e bundle or older hosts).
 */
function openApiKeysPage(): void {
  const ui =
    typeof Office !== "undefined" ? Office.context?.ui : undefined;
  if (ui && typeof ui.openBrowserWindow === "function") {
    ui.openBrowserWindow(API_KEYS_PAGE_URL);
  } else {
    window.open(API_KEYS_PAGE_URL, "_blank", "noopener,noreferrer");
  }
}

function isDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "true";
  } catch {
    return false;
  }
}

/** Shows the owner setup link when capability access is unavailable. */
export function ApiKeyBanner(): React.ReactElement | null {
  const [missingKey, setMissingKey] = useState(false);
  const [dismissed, setDismissed] = useState(isDismissed);

  useEffect(() => {
    let cancelled = false;
    getApiKeyStatus()
      .then((status: ApiKeyStatus) => {
        if (cancelled) return;
        const anyConfigured = status.capability;
        setMissingKey(!anyConfigured);
      })
      .catch(() => {
        // Unknown status — stay hidden rather than nag on a network blip.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!missingKey || dismissed) return null;

  const handleDismiss = (): void => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // Storage unavailable — dismiss still applies for this mount.
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Capability access is not configured.</span>{" "}
          <span className="text-amber-800">
            Ask the owner to configure Pramaan access.
          </span>
        </p>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={openApiKeysPage}
        className="mt-1.5 ml-[22px] rounded-md bg-amber-600 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-700"
      >
        View capability setup
      </button>
    </div>
  );
}
