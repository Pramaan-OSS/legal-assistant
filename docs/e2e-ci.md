# Browser verification

Install Node 22 and Playwright's Chromium runtime with npx playwright install chromium. Build and start the frontend on a local port, then run synthetic browser checks:

```sh
npm run build --prefix frontend
npm start --prefix frontend -- --port 3105
PLAYWRIGHT_BASE_URL=http://localhost:3105 npx playwright test --project=synthetic --retries=0
```

These checks use synthetic responses and block outside browser requests. All browser launches are headless. Stop the local server when finished. Logs, screenshots and traces belong under .data/verification or the ignored Playwright output folders. Database-backed checks need the local Docker stack and synthetic accounts; never substitute a live capability key.

The repository workflow runs plain lint, typecheck and fake-client tests. It does not publish, release, deploy or send external messages.
