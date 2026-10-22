import type { AssistantEvent } from "@/app/components/shared/types";


export function assistantHistoryContent(message: {
  content: string;
  events?: AssistantEvent[];
}): string {
  if (message.content) return message.content;
  return (message.events ?? [])
    .filter(
      (event): event is Extract<AssistantEvent, { type: "content" }> =>
        event.type === "content",
    )
    .map((event) => event.text)
    .join("");
}
