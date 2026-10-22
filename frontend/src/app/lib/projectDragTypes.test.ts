import { describe, expect, it } from "vitest";
import {
    isChatAttachmentDrag,
    isExternalFileDrag,
    isDocumentViewerDrag,
    isProjectItemDrag,
} from "./projectDragTypes";

describe("project drag types", () => {
    it.each([
        [["Files"], true],
        [["application/legal-assistant-doc"], true],
        [["application/legal-assistant-docs"], true],
        [["application/legal-assistant-folder"], false],
        [["application/legal-assistant-project-tab"], false],
        [["text/plain"], false],
    ])("recognizes viewer drops %j", (types, accepted) => {
        expect(isDocumentViewerDrag({ types: types as string[] })).toBe(
            accepted,
        );
    });
    it.each([
        [[], false, false, false],
        [["text/plain"], false, false, false],
        [["Files"], true, true, false],
        [["application/legal-assistant-doc"], true, false, true],
        [["application/legal-assistant-folder"], false, false, true],
        [["application/legal-assistant-doc", "Files"], true, true, true],
    ])("recognizes %j", (types, attachment, files, projectItem) => {
        const transfer = { types: types as string[] };
        expect(isChatAttachmentDrag(transfer)).toBe(attachment);
        expect(isExternalFileDrag(transfer)).toBe(files);
        expect(isProjectItemDrag(transfer)).toBe(projectItem);
    });
});
