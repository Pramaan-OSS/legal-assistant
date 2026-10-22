# Sign-in setup

Run `./start` after copying the root .env.example to .env and entering PRAMAAN_API_KEY. Startup opens a managed sign-in backend in test mode and configures the app’s public HTTPS origin from APP_URL when supplied. Localhost needs no domain update: development ports are allowed by default. The sign-in form uses the returned server address for email sign-up and connected sign-in; no separate social credentials are required.

The callback obtains a session token from the sign-in client and posts it to the app server. The server verifies it through auth.token.verify, checks the allowed identity list when configured, and consumes a short-lived browser flow once before opening its normal private-cookie session. Issuer and audience are checked by the platform against this app’s managed backend. Tokens never go into URLs or logs. Managed subjects get stable local identities; an email match never grants access to an existing account. Existing app data stays owned by its original local identity. Linking an old local account to a managed identity is not automatic; use the optional local path to retain that account.

When provisioning is unavailable or no key is set, local sign-in and the bundled mailbox remain available. Set LOCAL_SIGN_IN=1 to choose that path explicitly. Confirmation and recovery messages for local accounts appear at http://localhost:8025. Generated private settings persist in .env and .runtime; no database project keys need to be entered. ALLOWED_SIGN_IN accepts comma-separated exact managed subject ids or verified email addresses; an unverified claimed address cannot satisfy it.

Managed account erasure goes through auth.user.delete from the existing approved erasure job before the local identity is removed. An uncertain or refused erasure is recorded as failed for review and never silently retried. App-owned session and account settings remain separate from the managed server’s settings. No live end-to-end managed sign-in was performed by this template.

External account mail is optional: configure an authorized MAIL_FROM and SEND_EMAIL_VIA_PRAMAAN=true in .env, then run ./start again. Delivery goes through Pramaan; the generated SEND_EMAIL_HOOK_SECRET is shared automatically. Support mail defaults to support@legal-assistant.local; set SUPPORT_EMAIL for real delivery. Use HTTPS and private database credentials before public hosting.

With the optional own-client path selected, social sign-in exchanges the hosted authorization code through auth.social.exchange and binds the verified identity to a local account. Configure SOCIAL_SIGN_IN_URL and SOCIAL_PROVIDER_KEY to match the hosted authorization backend; AUTH_HANDOFF_ENCRYPTION_SECRET protects short-lived browser handoff data. Never accept an unverified email or browser-supplied identity as proof of account ownership.

Remote account sign-in uses public-client hosted authorization through Pramaan. FRONTEND_URL must be the public HTTPS app address. The connection service retains encrypted sign-in credentials; the app keeps only the owned connection reference and a transient, ten-minute link. See connectors.md for permissions and disconnect behavior. SAML is unavailable.


## Organization sign-in

An organization administrator opens Organization sign-in settings from its workspace. Register your customer-named HTTPS issuer and client identifier, select how its client authenticates, and provide a write-only secret when required. If discovery addresses use other hosts, list at most five additional lowercase host names. Configure exactly FRONTEND_URL/auth/callback?enterprise=1 at the identity service; FRONTEND_URL must be this app's public HTTPS origin. Secrets are forwarded once to encrypted Pramaan storage and never returned or stored in the app.

Administrators create, list and remove connections. Share the organization and local connection codes with members. A member must first sign in to their existing local account, open the organization's sign-in settings and link their organization identity. Later they can use the Organization sign-in link on the login screen with those codes. Successful sign-in uses the saved connection and identity subject, never an email match, and requires current organization membership. It cannot enroll users or add members; local accounts and sessions remain unchanged.

The start keeps state, nonce and the code verifier in private server-side storage and sends only a one-time flow ticket in a secure, HttpOnly cookie. Callback state must match before exchange. The flow is atomically consumed once, expires in ten minutes, and must have started through the platform. A failed/ambiguous redemption needs a fresh start; there is no automatic replay. The same signed-in local account must complete first linking. Removing a connection stops future enterprise sign-in and removes local bindings, while preserving local accounts.

Only OpenID Connect is covered: no SAML metadata, assertions or SAML callback validation are served. SAML remains disabled. The platform API is not deployed yet and these capabilities are not live-verified. Tests use synthetic responses; keep local sign-in available until the operator verifies their configuration. Apply the dated own-database migration before updating an existing deployment.

Remove all organization sign-in connections before deleting the organization. The own database refuses deleting an organization while these connections remain, preventing the platform secret from being orphaned by a local cascade.
