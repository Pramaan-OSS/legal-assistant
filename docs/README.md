# Legal Assistant documentation

[Run and configure the app](../README.md), [connected accounts and remote services](connectors.md), [sign-in](sign-in.md), and [interface tokens](design-system.md) describe the template without private working notes.

The Docker stack owns the database, accounts, queue and file volume. All external operations pass through backend/src/lib/pramaan.ts. Automated checks use fake responses; browser checks use headless Playwright. Runtime logs and screenshots belong under the ignored .data/verification folder.
