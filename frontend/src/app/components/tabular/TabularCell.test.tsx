import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TabularCell as TabularCellData } from "../shared/types";
import { TabularCell } from "./TabularCell";

describe("TabularCell", () => {
    it("passes the cited source document through the click handler", () => {
        const onCitationClick = vi.fn();
        const cell = {
            id: "cell-1",
            status: "done",
            content: {
                summary:
                    "Answer [[document:doc-2||page:4||quote:Exact language]]",
                flag: "grey",
                reasoning: "",
            },
        } as TabularCellData;

        render(
            <TabularCell
                cell={cell}
                onExpand={vi.fn()}
                onCitationClick={onCitationClick}
            />,
        );

        fireEvent.click(screen.getByTitle('Page 4: "Exact language"'));

        expect(onCitationClick).toHaveBeenCalledWith(
            4,
            "Exact language",
            1,
            undefined,
            undefined,
            "doc-2",
        );
    });
});


it("shows a failed cell's reason and the retry instruction", () => {
    const cell = { id: "failed-cell", status: "error", content: { summary: "", reasoning: "The connected service refused this request." } } as TabularCellData;
    const onExpand = vi.fn();
    render(<TabularCell cell={cell} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole("button", { name: "Review and retry" }));
    expect(onExpand).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("The connected service refused this request.");
    expect(screen.getByRole("alert")).toHaveTextContent("Regenerate");
});
