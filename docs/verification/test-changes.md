# Test coverage and fixture changes

Tests use a fake Pramaan client and synthetic local data. Removed-feature tests for per-provider key settings and direct vendor protocols were retired when those settings and integrations were removed. Retained permission, validation, document, account and conversation checks use fast, balanced and best quality choices; invalid choices and credential-redaction fixtures use neutral synthetic names.

Connected account tests cover manual cursor pages, session reuse, final-page handling, consent before redirect, direct copied-file parsing and retention of successful actions after copy/parse failure. Remote tests cover owned registration and sign-in, discovery, approval, fresh schemas, unknown results without retry and read-only restrictions. Outcomes test estimates and plan binding, availability, busy refusal, job polling, cancellation and partial/unknown reports without replay.

Historical SQL identifiers remain only where migration compatibility requires them. The public workflow runs plain local checks, so the obsolete assertion that workflow migration automation must exist was removed; the migration-reference check still rejects any dangling reference. Local evidence remains in ignored runtime folders.

Organization sign-in replaces the old email-domain/SAML submit fixture with explicit organization/connection code submission. Backend fake-client tests cover administrator authorization, create/list/delete, platform start, state/nonce/PKCE exchange, atomic replay rejection, expiry, unstarted flows, stable identity binding, local-account consistency and membership removal. The headless check uses synthetic configuration and hosted sign-in responses; no live issuer is contacted.

Structured request checks now cover all twenty-six built-in definitions, dynamic connected definitions, strict fake transport enforcement, streaming/whole/async dispatch, completion/extraction fields and future explicit recipe schemas. No tests were deleted. Three extraction expectations changed deliberately: interrupted partial cells no longer remain completed, failed cells retain their reason, and the worker rethrows the original call error rather than replacing it with a missing-columns error. Added failure-history checks and a visible failed-cell retry check.

Added fake upstream-unavailable checks for all four called legal capabilities, adapter/dispatch/stream/history checks, low reply-limit checks and a visible notice that survives collapsed steps while the next document request remains usable. No live requests or feature-test deletions.

Failure summaries now say Could not complete instead of Completed; three existing assistant timeline assertions were updated while retaining their successful-step, error-color and uncertainty checks. The shared summary test covers the new label.


Reply-length checks cover streamed and whole text, structured responses, async final results, single/multi-cell extraction, titles, column-prompt failures, action/memory dispatch and both background retry transports. Two SDK transport checks simulate charged HTTP 200 replies ending in length; another simulates the final uncharged maxTokens HTTP 400. No tests were deleted. The title expectation changes from 64 to 256. The existing synthetic browser check now covers success, dropped streams, cut-off replies and empty-reply configuration failure, each without an automatic repeat.

During the full local QA pass, document add-in sign-in checks were updated to the current connected sign-in label and shared button style. The stored-error history check now expects “Could not complete” and explicitly rejects a completed label when a stored step failed. Its event-order and error visibility assertions remain. A separate managed dialog check covers successful email return and refused redemption with synthetic responses. No checks were removed. The execution configuration preserves shared-module aliases while avoiding types-only React aliases, and the network guard follows the selected local test origin.

The same run corrected document-host assertions that assumed a fixed port and expected the old virtual file path after the fixture path had already changed. Those checks continue to assert same-origin cookie use and independent identities after a copied document is opened.

The conflict-retry check now verifies the primary action marker rather than the original blue color class; the shared design uses its own primary button style. Its revision acceptance, apply, reveal and final resolution checks are retained.
