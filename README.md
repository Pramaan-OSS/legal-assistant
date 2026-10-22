# Legal Assistant

A private legal workspace for documents, assistant conversations, verified citations and connected actions. Outside data and actions use one server-side Pramaan client. Sign-in and the database are provided through Pramaan in test mode; until the managed database is available, the bundled local database starts automatically.

## Run locally

Install Docker with Docker Compose, then:

```sh
cp .env.example .env   # paste PRAMAAN_API_KEY into .env
./start
```

The start command serves the optimized production build. Use it for normal use; the optional frontend development server compiles screens on first visit and can be much slower on a cold start.

Open http://localhost:3000. Use managed email sign-up or connected sign-in. If managed sign-in is unavailable, local accounts remain available and their confirmation messages appear at http://localhost:8025. No hosted database project, mail account, extra registry token or manually created secret is needed. The first start builds the app and starts its database, account service, mailbox and queue. Later starts reuse the persistent volumes, generated private keys and saved managed service configuration. Stop with `docker compose down`; this keeps your data. Never share `.env` or delete volumes unless you want to reset local data.

Only PRAMAAN_API_KEY is required. The start command generates session, hand-off, download-signing and mail-hook keys in private `.env` with restricted file permissions. All other settings are optional commented overrides in `.env.example`. Keep `.env` and the private `.runtime/` directory with your persistent database when backing up or moving the app. Managed database credentials are returned once, saved with restricted file permissions, and never printed; losing them needs approved credential recovery. Local database credentials are for a loopback-only development stack; configure private database credentials and HTTPS before public hosting.

The backend installs the published `@pramaan/sdk@0.1.0` package. Product cancellation and report helpers remain beside the single server-side client. Files use Pramaan storage with private disk as the unconfigured/refused fallback. Without a key, a visible message asks for PRAMAAN_API_KEY; local accounts, documents and editing still work. `PRAMAAN_FAKE=1` explicitly selects offline demonstration replies for verification; it never performs external actions.

Support mail defaults to support@legal-assistant.local; set SUPPORT_EMAIL to receive real support requests. Managed sign-in needs no separate social credentials. Managed email/password changes and recovery are not available in this app yet; local account controls apply only when local sign-in is selected. APP_URL defaults to http://localhost:3000; local development uses the managed server’s default localhost allowance. Set APP_URL to the app’s public HTTPS origin when hosting it; startup registers only that public origin. LOCAL_SIGN_IN=1 optionally selects local account sign-in; SOCIAL_SIGN_IN_URL and SOCIAL_PROVIDER_KEY remain optional for an independently configured sign-in client. ALLOWED_SIGN_IN optionally restricts managed sign-in to exact subject ids or verified email addresses. Organization sign-in is configured by an administrator in settings and requires a public HTTPS FRONTEND_URL. Connected apps remain disconnected until the user chooses and approves a connection. Set SEND_EMAIL_VIA_PRAMAAN=true when enabling external mail delivery. The default sender is Legal Assistant <noreply@updates.pramaan.one>; SUPPORT_EMAIL supplies the owner’s reply address. An optional MAIL_FROM must use that exact domain unless a sending account is connected. Default local confirmations and password recovery stay in the local mailbox.

## Checks

Use Node 22 or newer:

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm run build --prefix backend
npm run build --prefix frontend
npm test --prefix backend
npm test --prefix frontend
```

Tests use fake clients. See docs/README.md for configuration and feature notes.

## Connected accounts

Connecting an outside account, such as a document store or another app, carries a monthly Pramaan charge for each
connected account, billed to the Pramaan account behind `PRAMAAN_API_KEY`. Signing in is free. Disconnecting an account
ends its charge.

## Built on

Built on [Mike](https://github.com/Open-Legal-Products/mike), originally licensed under AGPL-3.0. The original licence is preserved in `LICENSE-ORIGINAL`; Legal Assistant is AGPL-3.0.

Connected accounts may grant broad access; the template cannot narrow the consent request. Before connecting, each app card states the known grant (or that full access may be requested) and the enabled-action/approval limits inside this product. Account access is never described as read-only. Optional access levels on apps.connection.start are planned in the lab, not available here. Hosted consent links last about 10 minutes.


Remote services can be added from Settings → Connectors using a user-supplied public HTTPS address. Hosted sign-in requires FRONTEND_URL to name this app's public HTTPS address; no-sign-in services can also be registered. Every remote action requires review, and limiting a remote service to reads blocks all its actions because their effects are unverified. Custom headers, token entry, manually registered sign-in clients, file transfer and streamed results are disabled. Sign-in links last ten minutes and are held only in server memory: after expiry or a restart, remove the pending connection and add the address again. Disconnect removes the platform sign-in but may require removing its grant at the service too. Remote connector capabilities are not live-verified.


## Sign-in and operation without a key

Managed tokens are verified through Pramaan before opening an app-owned session. Local accounts remain the no-key/unavailable fallback. Their confirmation and recovery mail goes to the local mailbox by default. Optional external mail and hosted sign-in settings are described above and in docs/sign-in.md.

Without a Pramaan key, local accounts, projects, document browsing, editing, uploads to private disk and exports remain available. Assistant generation, external research, citation verification, external delivery and connected actions require a key and served capabilities. Organization OpenID Connect sign-in uses administrator-configured connections and explicit member identity linking; the platform API is not deployed or live-verified yet. SAML and the bundled specialist legal connector remain unavailable. No capability has been live-verified by this template; operators must verify their own configured services before relying on them. The current platform reports legal research as not available yet; failed searches and citation checks show that message while document work remains usable.

Research recipes show an estimate for approval. Long runs can be stopped; a busy service asks the user to try later. An uncertain step requires checking before retrying and never starts a silent fallback.
