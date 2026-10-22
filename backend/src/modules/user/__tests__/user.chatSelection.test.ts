import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
const settings = vi.hoisted(() => vi.fn());
vi.mock("../user.settings", () => ({ getUserModelSettings: settings }));
import { resolveUserChatSelection } from "../user.chatSelection";

const profile = {
  last_selected_chat_model: "balanced",
  last_selected_reasoning_level: "low",
  api_keys: { legacyOne: "dummy", legacyTwo: "dummy", legacyThree: "dummy" },
};
const db = {} as Db; // Model selection with built-in models performs no writes.
beforeEach(() => {
  vi.clearAllMocks();
  settings.mockResolvedValue(profile);
});

describe("cross-surface chat selection", () => {
  it.each([
    [
      { requestedModel: "balanced", chatModel: "balanced" },
      "balanced",
    ],
    [{ chatModel: "balanced" }, "balanced"],
    [{}, "balanced"],
  ])(
    "selects request, then chat, then profile: %j",
    async (args, selectedModel) => {
      expect(
        await resolveUserChatSelection(db, { userId: "actor", ...args }),
      ).toMatchObject({ ok: true, selectedModel, modelSettings: profile });
      expect(settings).toHaveBeenCalledExactlyOnceWith("actor", db);
    },
  );

  it.each([
    [{ requestedReasoning: "high", chatReasoningLevel: "medium" }, "high"],
    [{ chatReasoningLevel: "medium" }, "medium"],
    [{}, "low"],
    [{ requestedReasoning: "max" }, "max"],
  ])(
    "selects and normalizes reasoning: %j",
    async (args, selectedReasoningLevel) => {
      expect(
        await resolveUserChatSelection(db, { userId: "actor", ...args }),
      ).toMatchObject({ ok: true, selectedReasoningLevel });
    },
  );

  it("keeps explicit invalid requests as failures instead of falling back", async () => {
    expect(
      await resolveUserChatSelection(db, {
        userId: "actor",
        requestedModel: "not-a-model",
      }),
    ).toMatchObject({ ok: false, status: 400, code: "model_unavailable" });
  });
  it("preserves the missing server-key failure", async () => {
    vi.stubEnv("PRAMAAN_API_KEY", "");
    settings.mockResolvedValue({ ...profile, api_keys: {} });
    expect(
      await resolveUserChatSelection(db, {
        userId: "actor",
        requestedModel: "balanced",
      }),
    ).toMatchObject({ ok: false, status: 422, code: "missing_api_key" });
  });
  it("defaults to Balanced when no quality was saved", async () => {
    settings.mockResolvedValue({ ...profile, last_selected_chat_model: null });
    expect(
      await resolveUserChatSelection(db, { userId: "actor" }),
    ).toMatchObject({ ok: true, selectedModel: "balanced" });
  });
});
