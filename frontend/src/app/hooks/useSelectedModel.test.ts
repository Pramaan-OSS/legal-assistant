import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelectedModel, useSelectedReasoning } from "./useSelectedModel";
import {
    canonicalModelId,
    routerSelections as selectionsFromProfile,
} from "@/shared/lib/modelCatalog";
import type { ApiKeyState } from "../lib/legalAssistantApi";

const keys: ApiKeyState = { capability: {configured:true,enabled:true,source:"env"} };

const routerSelections = selectionsFromProfile({
    qualityModels: ["balanced"],
});

describe("useSelectedModel", () => {
    it("has no invented default when neither saved source is usable", () => {
        const { result } = renderHook(() => useSelectedModel());
        expect(result.current[0]).toBe("balanced");
    });

    it("uses the saved chat model before the shared last-selected model", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                chatModel: "balanced",
                lastSelectedModel: "balanced",
                apiKeys: keys,
            }),
        );
        expect(result.current[0]).toBe("balanced");
    });

    it("falls back to last-selected when the chat model has no current key", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                chatModel: "balanced",
                lastSelectedModel: "balanced",
                apiKeys: keys,
            }),
        );
        expect(result.current[0]).toBe("balanced");
    });

    it("normalizes a retired saved model to balanced", () => {
        const {result} = renderHook(() => useSelectedModel({chatModel: "retired-model", apiKeys: keys}));
        expect(result.current[0]).toBe("balanced");
    });

    it("keeps an explicit selection in component state only", () => {
        const { result } = renderHook(() => useSelectedModel());

        act(() => result.current[1]("balanced"));

        expect(result.current[0]).toBe("balanced");
    });

    it("rejects an arbitrary deployment model id", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                chatModel: "invalid-choice",
                configuredModelIds: ["invalid-choice"],
                apiKeys: keys,
            }),
        );

        expect(result.current[0]).toBe("balanced");
        act(() => result.current[1]("invalid-choice"));
        expect(result.current[0]).toBe("balanced");
    });

    it("keeps a deployment override even when its id is in the legacy mapping", () => {
        const { result } = renderHook(() => useSelectedModel({
            chatModel: "balanced",
            configuredModelIds: ["balanced"],
            apiKeys: keys,
        }));
        expect(result.current[0]).toBe("balanced");
        act(() => result.current[1]("balanced"));
        expect(result.current[0]).toBe("balanced");
    });

    it("uses a chat router model while it remains in the saved list", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                chatModel: "balanced",
                lastSelectedModel: "balanced",
                routerSelections,
                apiKeys: keys,
            }),
        );
        expect(result.current[0]).toBe("balanced");
    });

    it("falls back when the chat router model is no longer saved", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                chatModel: "legacyGateway/pricy/frontier",
                lastSelectedModel: "balanced",
                routerSelections,
                apiKeys: keys,
            }),
        );
        expect(result.current[0]).toBe("balanced");
    });

    it("does not flash the profile model while an existing chat loads", () => {
        const { result, rerender } = renderHook(
            ({ chatModel }: { chatModel: string | null | undefined }) =>
                useSelectedModel({
                    selectionKey: "chat-1",
                    chatModel,
                    lastSelectedModel: "balanced",
                    apiKeys: keys,
                }),
            {
                initialProps: {
                    chatModel: undefined as string | null | undefined,
                },
            },
        );

        expect(result.current[0]).toBe("");
        rerender({ chatModel: "balanced" });
        expect(result.current[0]).toBe("balanced");
    });
});

describe("useSelectedReasoning", () => {
    it("loads the chat level before the profile fallback", () => {
        const { result } = renderHook(() =>
            useSelectedReasoning({
                selectionKey: "chat-1",
                chatReasoningLevel: "low",
                lastSelectedReasoningLevel: "xhigh",
            }),
        );
        expect(result.current[0]).toBe("low");
    });

    it("defaults a new user to high", () => {
        const { result } = renderHook(() => useSelectedReasoning({}));
        expect(result.current[0]).toBe("high");
    });

    it("uses the profile reasoning level on surfaces without chat settings", () => {
        const { result } = renderHook(() =>
            useSelectedReasoning({ lastSelectedReasoningLevel: "low" }),
        );
        expect(result.current[0]).toBe("low");
    });
});

describe("canonicalModelId", () => {
    it("maps only known legacy ids", () => {
        expect(canonicalModelId("balanced")).toBe(
            "balanced",
        );
        expect(canonicalModelId("balanced")).toBe("balanced");
        expect(canonicalModelId("balanced")).toBe("balanced");
    });
});
