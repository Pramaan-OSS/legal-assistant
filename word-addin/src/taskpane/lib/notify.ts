/** Passive task-pane notifications; recovery actions are reviewed separately. */
import { describeError, type DescribeErrorOptions, type UserFacingError } from "@legal-assistant/user-error";
import { showToast } from "@legal-assistant/toast-store";

export function notifyError(error: unknown, options: DescribeErrorOptions & { dedupeKey?: string } = {}): UserFacingError | null {
  const described = describeError(error, options);
  if (described.kind === "aborted") return null;

  showToast({ tone: "error", title: described.title, message: described.message, dedupeKey: options.dedupeKey });
  return described;
}
