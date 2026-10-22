# Word add-in development

Use Node 22. Run npm ci --prefix word-addin, npm run build --prefix word-addin, and npm run test:server --prefix word-addin. The add-in uses the same authenticated app API and core interface tokens as the frontend. Office.js is the required document host runtime.

Automated browser checks must use headless Playwright with synthetic responses. Local runtime artifacts are ignored; credentials and real documents do not belong in fixtures. See word-addin/README.md for host setup.
