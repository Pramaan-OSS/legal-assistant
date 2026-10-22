import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelOption } from "@/shared/lib/modelCatalog";

const { updateModelPreference, configuredModels } = vi.hoisted(() => ({
    updateModelPreference: vi.fn(async () => true),
    configuredModels: [] as ModelOption[],
}));

vi.mock("@/app/hooks/useLocalModels", () => ({
    useLocalModels: () => [],
}));
vi.mock("@/app/hooks/useConfiguredModels", () => ({
    useConfiguredModels: () => configuredModels,
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: {
            // Legacy id stored before the catalog rename.
            titleModel: "balanced",
            tabularModel: "balanced",
            memoryCuratorModel: "balanced",
            legacyGatewayModels: [],
            legacyHostingModels: [],
            legacyServiceGoModels: [],
            apiKeys: { capability: {configured:true,enabled:true,source:"env"} },
        },
        updateModelPreference,
    }),
}));

import ModelPreferencesPage from "./page";

describe("model preferences page legacy ids", () => {
    beforeEach(() => {
        updateModelPreference.mockClear();
        configuredModels.length = 0;
    });

    it("shows neutral quality preferences", () => {
        render(<ModelPreferencesPage/>);
        expect(screen.getAllByRole("button", {name: "Balanced"})).toHaveLength(3);
    });
    it("saves a selected memory quality", async () => {
        render(<ModelPreferencesPage/>);
        await userEvent.click(screen.getAllByRole("button", {name: "Balanced"})[2]);
        await userEvent.click(screen.getByText("Best"));
        expect(updateModelPreference).toHaveBeenCalledWith("memoryCuratorModel", "best");
    });
});
