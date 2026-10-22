# Authentication mail delivery

The own auth server signs mail events; the app verifies the raw body, timestamp and signature before calling email.send through the shared client. Delivery keys stay stable across retries. Email-change confirmation uses both mailbox proofs when present.

Contract sources: [send-email hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook) and [self-hosted hook configuration](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-hooks). The current-mailbox proof uses token_hash_new; the new-mailbox proof uses token_hash. Three fake-client checks cover signature/timestamp rejection, mailbox mapping and delivery retries.
