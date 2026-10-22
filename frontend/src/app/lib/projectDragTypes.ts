type DragTypes = Pick<DataTransfer, "types">;

export function isDocumentViewerDrag(dataTransfer: DragTypes): boolean {
    return (
        isExternalFileDrag(dataTransfer) ||
        dataTransfer.types.includes("application/legal-assistant-doc") ||
        dataTransfer.types.includes("application/legal-assistant-docs")
    );
}

export function isProjectItemDrag({ types }: DragTypes): boolean {
    return (
        types.includes("application/legal-assistant-doc") ||
        types.includes("application/legal-assistant-folder")
    );
}

export function isExternalFileDrag({ types }: DragTypes): boolean {
    return types.includes("Files");
}

export function isChatAttachmentDrag(dataTransfer: DragTypes): boolean {
    return (
        isExternalFileDrag(dataTransfer) ||
        dataTransfer.types.includes("application/legal-assistant-doc")
    );
}
