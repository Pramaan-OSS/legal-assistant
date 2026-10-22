import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserApiKeys, getAllUserRouterModels } = vi.hoisted(() => ({
    getUserApiKeys: vi.fn(),
    getAllUserRouterModels: vi.fn(),
}));

vi.mock("../user.apiKeyStore", () => ({
    getUserApiKeys: (...args: unknown[]) => getUserApiKeys(...args),
}));

vi.mock("../../../lib/routerModels", async () => ({
    ...(await vi.importActual<typeof import("../../../lib/routerModels")>(
        "../../../lib/routerModels",
    )),
    getAllUserRouterModels: (...args: unknown[]) =>
        getAllUserRouterModels(...args),
}));

vi.mock("../../../lib/supabase", () => ({ createServerSupabase: vi.fn() }));

import { getUserModelSettings } from "../user.settings";

function profileDb(row: Record<string, unknown> | null) {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq"]) {
        chain[method] = vi.fn(() => chain);
    }
    chain.single = vi.fn(async () => ({ data: row, error: null }));
    chain.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
    return chain as never;
}

const NO_KEYS = {
    legacyTwo: null,
    legacyThree: "env-legacyThree-key",
    legacyOne: null,
    legacyGateway: "env-legacyGateway-key",
    legacyHosting: null,
    caseLaw: null,
};

beforeEach(() => {
    vi.clearAllMocks();
    getUserApiKeys.mockResolvedValue(NO_KEYS);
    getAllUserRouterModels.mockResolvedValue({
        legacyGateway: ["allowed/model"],
        legacyHosting: [],
        "legacyService-go": [],
    });
});

describe("getUserModelSettings router-model allowlist", () => {
    it("loads the professional profile used to personalise prompts", async () => {
        const settings = await getUserModelSettings(
            "user-1",
            profileDb({
                title_model: "balanced",
                tabular_model: "balanced",
                legal_research_us: true,
                display_name: "Ada",
                organisation: "Acme LLP",
                jurisdiction: "Singapore",
                practice_setting: "private_practice",
                professional_title: "Partner",
                practice_areas: ["Litigation"],
                custom_instructions: "Use British spelling.",
                response_style: { verbosity: "concise", tone: "formal" },
            }),
        );

        expect(settings.personalisation).toEqual({
            displayName: "Ada",
            organisation: "Acme LLP",
            jurisdiction: "Singapore",
            practiceSetting: "private_practice",
            professionalTitle: "Partner",
            practiceAreas: ["Litigation"],
            customInstructions: "Use British spelling.",
            responseStyle: {
                verbosity: "concise",
                formatting: "balanced",
                tone: "formal",
                language: "auto",
            },
        });
    });

    it("normalizes a legacy saved route to Balanced", async () => {
        const settings = await getUserModelSettings(
            "user-1",
            profileDb({
                title_model: "legacyGateway/allowed/model",
                tabular_model: "legacyGateway/allowed/model",
                memory_curator_model: "legacyGateway/allowed/model",
                legal_research_us: true,
            }),
        );

        expect(settings.title_model).toBe("balanced");
        expect(settings.tabular_model).toBe("balanced");
        expect(settings.memory_curator_model).toBe("balanced");
    });

    it("normalizes unavailable legacy routes without vendor routing", async () => {
        const settings = await getUserModelSettings(
            "user-1",
            profileDb({
                title_model: "legacyGateway/pricy/frontier-model",
                tabular_model: "legacyHosting/pricy/frontier-model",
                memory_curator_model: "legacyGateway/pricy/frontier-model",
                legal_research_us: true,
            }),
        );

        expect(settings.title_model).toBe("balanced");
        expect(settings.tabular_model).toBe("balanced");
        expect(settings.memory_curator_model).toBe("balanced");
    });

    it("keeps first-party preferences untouched", async () => {
        const settings = await getUserModelSettings(
            "user-1",
            profileDb({
                title_model: "balanced",
                tabular_model: "balanced",
                memory_curator_model: "balanced",
                legal_research_us: true,
            }),
        );

        expect(settings.title_model).toBe("balanced");
        expect(settings.tabular_model).toBe("balanced");
        expect(settings.memory_curator_model).toBe("balanced");
    });
});

// A database without the 20260821 onboarding migration rejects the widened
// select outright (42703). The retry with the pre-migration column set must
// preserve the user's saved models and legal-research choice — silently
// resetting them was the severe half of the un-migrated-DB bug.
function retryingProfileDb(
    first: { data: unknown; error: unknown },
    second: { data: unknown; error: unknown },
) {
    const results = [first, second];
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq"]) {
        chain[method] = vi.fn(() => chain);
    }
    chain.single = vi.fn(async () => results.shift() ?? second);
    return chain as never;
}

describe("getUserModelSettings on an un-migrated database", () => {
    it("retries without the memory curator column during rollout", async () => {
        const settings = await getUserModelSettings(
            "user-1",
            retryingProfileDb(
                {
                    data: null,
                    error: {
                        code: "42703",
                        message:
                            "column user_profiles.memory_curator_model does not exist",
                    },
                },
                {
                    data: {
                        title_model: "balanced",
                        tabular_model: "balanced",
                        last_selected_chat_model: "balanced",
                        last_selected_reasoning_level: "high",
                        legal_research_us: true,
                    },
                    error: null,
                },
            ),
        );

        expect(settings.memory_curator_model).toBeNull();
        expect(settings.last_selected_reasoning_level).toBe("high");
        expect(settings.last_selected_chat_model).toBe("balanced");
    });

    it("retries without the onboarding columns and keeps saved settings", async () => {
        const settings = await getUserModelSettings(
            "user-1",
            retryingProfileDb(
                {
                    data: null,
                    error: {
                        code: "42703",
                        message:
                            "column user_profiles.jurisdiction does not exist",
                    },
                },
                {
                    data: {
                        title_model: "balanced",
                        tabular_model: "balanced",
                        legal_research_us: false,
                    },
                    error: null,
                },
            ),
        );

        expect(settings.title_model).toBe("balanced");
        expect(settings.tabular_model).toBe("balanced");
        expect(settings.legal_research_us).toBe(false);
        expect(settings.personalisation).toMatchObject({
            displayName: null,
            practiceAreas: [],
        });
    });

    it("returns empty optional preferences when the retry also fails", async () => {
        const settings = await getUserModelSettings(
            "user-1",
            retryingProfileDb(
                {
                    data: null,
                    error: {
                        code: "42703",
                        message:
                            "column user_profiles.jurisdiction does not exist",
                    },
                },
                {
                    data: null,
                    error: { code: "42703", message: "even older database" },
                },
            ),
        );

        expect(settings.legal_research_us).toBe(true);
        expect(settings.title_model).toBeNull();
        expect(settings.tabular_model).toBeNull();
    });
});
