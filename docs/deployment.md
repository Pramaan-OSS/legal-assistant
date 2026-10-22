# Running Legal Assistant

Use the own Docker stack described in the root README. The app needs only a server-side `PRAMAAN_API_KEY` for managed setup in test mode; it does not accept individual vendor keys. Keep the database, Redis, local account/session server and large-file filesystem private and persistent.

The browser reaches the app API through `/api`. Set `APP_URL`, `FRONTEND_URL` and `API_PUBLIC_URL` to the owner's HTTPS app origin before deployment. Signed storage URLs never reach the browser. Up to 25 MB uses `storage.object.put`; larger files use resumable raw multipart uploads. The own filesystem retains staging/cache, remote-pointer metadata and progress journals, and is the fallback when storage declines an upload or no key is configured; preserve its volume and backups. Large objects are verified by streamed SHA-256 through the server-only client.

Local mail goes to the bundled mailbox by default. For external delivery, set `SEND_EMAIL_VIA_PRAMAAN=true`. The default sender is `Legal Assistant <noreply@updates.pramaan.one>`; set `SUPPORT_EMAIL` for support delivery and owner replies. An optional `MAIL_FROM` must use exactly `updates.pramaan.one` unless a sending account is connected. Social sign-in is optional: configure the approved hosted authorization page with `SOCIAL_SIGN_IN_URL` and its `SOCIAL_PROVIDER_KEY`. Otherwise email/password sign-in remains available. See `.env.example`.

The Word add-in needs the owner's HTTPS `WORD_ADDIN_PUBLIC_URL` and `REACT_APP_WEB_APP_URL`. Office.js remains the required host runtime. No deployment or publication was performed for this template.

Back up the private .runtime directory with .env. Managed database connection addresses are delivered once and saved privately; a lost response is not retried with a new creation key. Production currently refuses database provisioning, so the startup command announces its local fallback. Once provisioned, the account service, data gateway and migrations all use the selected database; the frontend never receives its connection string.

Before enabling public sign-up, publish the service owner’s terms and privacy policy. This template includes no service agreement or privacy policy and does not ask users to agree to missing pages.
