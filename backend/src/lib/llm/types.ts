// Shared types for capability generation and app-owned tool rounds.

export type Quality = "fast" | "balanced" | "best";
export type Provider = "capability";

export const REASONING_LEVELS = [
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export type ToolSchema = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

export type LlmMessage = {
    role: "user" | "assistant";
    content: string;
    /**
     * The reasoning this assistant turn produced, as persisted. Only sent
     * with the local conversation.
     */
    reasoning?: string;
};

export type NormalizedToolCall = {
    id: string;
    name: string;
    input: Record<string, unknown>;
};

export type NormalizedToolResult = {
    tool_use_id: string;
    content: string;
};

export type StreamCallbacks = {
    /** Meaningful capability output, even when the consumer buffers it. */
    onActivity?: () => void;
    onReasoningDelta?: (text: string) => void;
    onReasoningBlockEnd?: () => void;
    onContentDelta?: (text: string) => void;
    onToolCallStart?: (call: NormalizedToolCall) => void;
};

/** Outside access belongs to the server-side Pramaan client. */
export type UserApiKeys = { capability?: boolean };
export type ProviderSettings = Record<string, never>;

export type StreamChatParams = {
    model: string;
    systemPrompt: string;
    messages: LlmMessage[];
    tools?: ToolSchema[];
    maxIterations?: number;
    callbacks?: StreamCallbacks;
    runTools?: (calls: NormalizedToolCall[]) => Promise<NormalizedToolResult[]>;
    apiKeys?: UserApiKeys;
    /**
     * Require the selected provider to preserve tool calling. Curator jobs set
     * this so a provider capability error is retryable instead of silently
     * degrading into a tool-less response that looks like "no change".
     */
    requireTools?: boolean;
    /**
     * AI SDK reasoning effort. Bulk extraction jobs should leave this unset;
     * the SDK adapter maps an omitted level to "none" to save tokens and
     * latency.
     */
    reasoning?: ReasoningLevel;
    abortSignal?: AbortSignal;
    /** Durable conversation id for the app-owned generation context. */
    conversationId?: string | null;
};

export type StreamChatResult = {
    fullText: string;
};

// The catalog is limited to the registered quality choices.
export type ModelLocation = "cloud" | "local";
export type ConfiguredModel = { id: Quality; provider: "capability"; location: ModelLocation; label?: string };

/**
 * A committee answers one prompt with several models and has a chair model
 * synthesize their replies into the single response the caller sees.
 */
export type CommitteeModel = {
    id: string;
    label?: string;
    members: Array<
        | string
        | {
              id?: string;
              model: string;
              label?: string;
              systemPrompt?: string;
          }
    >;
    chair: string;
    strategy?: "synthesize";
};
