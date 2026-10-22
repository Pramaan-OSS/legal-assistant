# Local development

Use Node 22 or newer. The root README explains the own Docker stack. Copy `.env.example` to an untracked `.env`, set only the server-side Pramaan key, then run `./start`. Local account/session authentication, Postgres, Redis, document conversion and private disk storage run on the own stack.

For the built-in offline check, set `PRAMAAN_FAKE=1` in the private root .env and run `./start`, then `node scripts/check-zero-config.mjs` after installing root test dependencies. Use `--no-key` to check the missing-key notice. All browser checks are headless.

For the more detailed fake-only browser checks, run `node docs/verification/fake-pramaan.mjs` on port 3417 and add `-f docs/verification/compose.fake.yml` to Compose. This fixture does not forward calls and accepts only its fake verification key. Never use a real Pramaan key for tests. The override points the own backend to the local fixture through `host.docker.internal`.

Run backend and frontend unit tests with `npm test --prefix backend -- --maxWorkers=2` and `npm test --prefix frontend -- --maxWorkers=2`. Compile with the corresponding `npm run build` commands. The Word add-in also requires an owner-controlled HTTPS URL to generate its production manifest; its real Office host was not exercised during template verification.
