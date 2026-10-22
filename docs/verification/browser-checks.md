# Headless browser checks

Use the synthetic Playwright project to check estimates and approval, interrupted replies, connected account discovery, permission notices, remote service registration and large uploads. Synthetic responses block outside browser requests. No capability key or real customer account is needed.

Build/start the frontend as described in ../e2e-ci.md. Run npx playwright test --project=synthetic --retries=0. Screenshots, traces and logs are private runtime evidence under ignored .data/verification, test-results or playwright-report; they are not part of the public template.
