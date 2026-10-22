import { describe, expect, it, vi } from "vitest";
import {
    publishTabularChatSettingsUpdate,
    subscribeToTabularChatSettingsUpdates,
} from "./tabularChatSettingsEvents";

describe("tabularChatSettingsEvents", () => {
    it("publishes chat-specific model and reasoning updates", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToTabularChatSettingsUpdates(listener);

        publishTabularChatSettingsUpdate({
            reviewId: "review-1",
            chatId: "chat-1",
            model: "balanced",
        });
        publishTabularChatSettingsUpdate({
            reviewId: "review-1",
            chatId: "chat-1",
            reasoningLevel: "low",
        });

        expect(listener).toHaveBeenNthCalledWith(1, {
            reviewId: "review-1",
            chatId: "chat-1",
            model: "balanced",
        });
        expect(listener).toHaveBeenNthCalledWith(2, {
            reviewId: "review-1",
            chatId: "chat-1",
            reasoningLevel: "low",
        });

        unsubscribe();
        publishTabularChatSettingsUpdate({
            reviewId: "review-1",
            chatId: "chat-1",
            model: "balanced",
        });
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
