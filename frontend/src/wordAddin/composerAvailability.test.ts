/**
 * Word add-in composer availability semantics, exercised from the frontend
 * test runner (the add-in package has no unit-test runner of its own).
 */
import { describe, expect, it, vi } from "vitest";
import {
    isModelAvailable,
    unavailableModelMessage,
} from "../../../word-addin/src/taskpane/lib/modelCatalog";
import { loadWithRetry } from "../../../word-addin/src/taskpane/lib/composerPreflight";
import type { ApiKeyStatus } from "../../../word-addin/src/taskpane/types";

const NO_KEYS: ApiKeyStatus = { capability: false } as ApiKeyStatus;

describe("isModelAvailable fail-open", () => {
    it("allows sends while key status is unknown (null)", () => {
        // A flaky WKWebView preflight must not brick the composer: the
        // backend still rejects models it cannot serve.
        expect(isModelAvailable("balanced", null)).toBe(true);
        expect(isModelAvailable("balanced", null)).toBe(true);
        expect(isModelAvailable("fast", null)).toBe(true);
        expect(isModelAvailable("best", null)).toBe(true);
        expect(isModelAvailable("balanced", null)).toBe(true);
    });

    it("still gates on a LOADED status", () => {
        expect(isModelAvailable("balanced", NO_KEYS)).toBe(false);
        expect(isModelAvailable("fast", NO_KEYS)).toBe(
            false,
        );
        expect(isModelAvailable("balanced", NO_KEYS)).toBe(false);
        expect(
            isModelAvailable("balanced", {
                ...NO_KEYS,
                capability: true,
            }),
        ).toBe(true);
        expect(
            isModelAvailable("balanced", {
                ...NO_KEYS,
                capability: true,
            }),
        ).toBe(true);
    });
});

describe("unavailableModelMessage", () => {
 it("directs access setup to the owner without naming a provider", () => { expect(unavailableModelMessage("balanced", NO_KEYS)).toBe("Ask the owner to configure capability access."); });
});

describe("loadWithRetry", () => {
    it("returns the value from a successful retry", async () => {
        const load = vi
            .fn()
            .mockRejectedValueOnce(new Error("transient"))
            .mockResolvedValueOnce("loaded");

        await expect(
            loadWithRetry(load, { delayMs: 0 }),
        ).resolves.toBe("loaded");
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("resolves null and reports the error after the final failure", async () => {
        const boom = new Error("still down");
        const load = vi.fn().mockRejectedValue(boom);
        const onFinalFailure = vi.fn();

        await expect(
            loadWithRetry(load, { delayMs: 0, onFinalFailure }),
        ).resolves.toBeNull();
        expect(load).toHaveBeenCalledTimes(2);
        expect(onFinalFailure).toHaveBeenCalledWith(boom);
    });

    it("does not retry after a success", async () => {
        const load = vi.fn().mockResolvedValue("ok");

        await expect(loadWithRetry(load, { delayMs: 0 })).resolves.toBe("ok");
        expect(load).toHaveBeenCalledTimes(1);
    });
});
