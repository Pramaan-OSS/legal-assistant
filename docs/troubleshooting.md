# Troubleshooting

Use the own Docker stack from README.md. If generation fails, the owner should check server-side capability access. Never add individual vendor keys. Check the own server logs using the request id shown by the app.

Authentication mail goes through email.send, including local password reset and confirmation. Tests use only the local fake Pramaan server. Unavailable social configuration leaves email/password sign-in available. Unsupported connectors and organization sign-in have explicit pending-coverage messages.

Preserve own database, queue and filesystem volumes. Files above 25 MB remain on own disk. Older binary Office files between 1 MiB and 25 MB need PDF/current Office format until raw staging is supported.
