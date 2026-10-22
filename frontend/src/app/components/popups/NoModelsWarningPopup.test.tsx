import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoModelsWarningPopup } from "./NoModelsWarningPopup";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn() }),
}));

describe("NoModelsWarningPopup", () => {
    it("asks to turn a provider back on when every saved key is switched off", () => {
        render(
            <NoModelsWarningPopup
                reason="providers-disabled"
                onClose={vi.fn()}
            />,
        );

        expect(
            screen.getByText(
                "Capability access is unavailable.",
            ),
        ).toBeInTheDocument();
        expect(
            screen.queryByText(/Add an API key/),
        ).not.toBeInTheDocument();
    });
});
