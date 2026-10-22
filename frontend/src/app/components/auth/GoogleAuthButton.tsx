"use client";
import { managedAddress, managedSocial } from '@/app/lib/managedSignIn';

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { startGoogleOAuth } from "@/app/lib/authApi";
import {
    describeError,
    type UserFacingError,
} from "@/app/lib/userFacingError";

const GOOGLE_ERROR_MESSAGES = {
    provider_disabled:
        "Connected sign-in is turned off for this workspace. Use your email and password instead.",
    oauth_provider_not_supported:
        "Connected sign-in is turned off for this workspace. Use your email and password instead.",
    over_request_rate_limit: "Too many attempts. Wait a moment and try again.",
} as const;

interface GoogleAuthButtonProps {
    /** Receives a classified failure, or `null` when the error is cleared. */
    onError: (error: UserFacingError | null) => void;
    disabled?: boolean;
    onLoadingChange?: (loading: boolean) => void;
}

export function GoogleAuthButton({
    onError,
    disabled = false,
    onLoadingChange,
}: GoogleAuthButtonProps) {
    const [loading, setLoading] = useState(false);
    const [configured, setConfigured] = useState<boolean | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        fetch('/api/auth/options', { signal: controller.signal })
            .then(response => response.ok ? response.json() : null)
            .then(options => { if (options) setConfigured(options.managed === true || options.socialSignIn === true); })
            .catch(() => {});
        return () => controller.abort();
    }, []);

    const handleGoogleAuth = async () => {
        setLoading(true);
        onLoadingChange?.(true);
        onError(null);

        try {
            if(managedAddress()) {await managedSocial();return;}
            const { url } = await startGoogleOAuth("/onboarding/profile");
            window.location.assign(url);
        } catch (error: unknown) {
            // A provider error message ("invalid_client", a stack line) is
            // never shown; the caller renders the classified text instead.
            onError(
                describeError(error, {
                    action: "use connected sign-in",
                    codeMessages: GOOGLE_ERROR_MESSAGES,
                    fallback:
                        "Unable to use connected sign-in. Try again, or log in with your email and password.",
                }),
            );
            setLoading(false);
            onLoadingChange?.(false);
        }
    };

    if (configured === false) return <p className="text-sm text-muted-foreground">Connected sign-in is not set up yet. Set SOCIAL_SIGN_IN_URL and SOCIAL_PROVIDER_KEY to enable it. Use email and password.</p>;

    return (
        <PillButtonUI
            type="button"
            tone="white"
            size="normal"
            className="w-full"
            disabled={disabled || loading}
            loading={loading}
            onClick={() => void handleGoogleAuth()}
        >
            <Globe aria-hidden="true" className="h-4 w-4" />
            {loading ? "Continuing…" : "Connected sign-in"}
        </PillButtonUI>
    );
}
