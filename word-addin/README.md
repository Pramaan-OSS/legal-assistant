# Legal Assistant Word add-in

The add-in provides document-aware conversations, workflows and tracked edits in a Word task pane. It uses the same authenticated app API and Pramaan connection as the web app; no separate generation key is needed. Word conversations are stored separately.

Use Node 22, a running Legal Assistant backend. Use Connected sign-in for a managed email or social account; the email/password form in the task pane remains available for local accounts. Set WORD_ADDIN_URL on the backend to the add-in’s own origin before connecting it. Office.js is the required host runtime. For local host development, run bash word-addin/scripts/dev.sh from the repository root. For production compilation, supply app-owned HTTPS origins:

```sh
npm ci --prefix word-addin
REACT_APP_WEB_APP_URL=https://app.example.test WORD_ADDIN_PUBLIC_URL=https://word.example.test npm run build --prefix word-addin
npm run test:server --prefix word-addin
```

Replace the example origins with your own before installing the generated manifest. Production API requests use the same-origin /api gateway so session cookies remain private. Browser verification uses headless Playwright and synthetic responses; real host installation must be checked by the operator. Keep generated bundles, sessions and screenshots out of the public tree. Generation and outside actions need PRAMAAN_API_KEY on the backend; local document editing uses the Word host.
