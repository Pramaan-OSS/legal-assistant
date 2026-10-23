// Offline CI harness for the bundled database and sign-in services.
import { createHmac } from "node:crypto";
import http from "node:http";
import { spawnSync } from "node:child_process";
const secret = "ci-only-jwt-secret-at-least-32-characters-long";
const token = role => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const data = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, iss: "supabase", iat: 1, exp: 4102444800 })}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
};
const auth = process.env.CI_AUTH_URL || "http://127.0.0.1:9999";
const rest = process.env.CI_REST_URL || "http://127.0.0.1:3001";
const port = Number(process.env.CI_GATEWAY_PORT || 8080);
const database = process.env.CI_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const gateway = http.createServer((request, response) => {
  const isAuth = request.url.startsWith("/auth/v1/");
  const target = new URL(request.url.replace(isAuth ? "/auth/v1" : "/rest/v1", ""), isAuth ? auth : rest);
  const upstream = http.request(target, { method: request.method, headers: request.headers }, result => {
    response.writeHead(result.statusCode, result.headers);
    result.pipe(response);
  });
  upstream.on("error", () => { response.writeHead(502); response.end(); });
  request.pipe(upstream);
});
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
};
try {
  await new Promise(resolve => gateway.listen(port, "127.0.0.1", resolve));
  run("psql", [database, "-X", "-v", "ON_ERROR_STOP=1", "-c", "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$; GRANT anon, authenticated, service_role TO postgres; CREATE SCHEMA IF NOT EXISTS auth;"]);
  for (const url of [`${auth}/health`, `${rest}/`]) {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(url)).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error(`Local CI service did not become ready: ${url}`);
  }
  const initialized = spawnSync("psql", [database, "-XAt", "-c", "select to_regclass('public.user_profiles')"], { encoding: "utf8" });
  if (initialized.status !== 0) throw new Error("Cannot inspect CI database");
  if (!initialized.stdout.trim()) run("psql", [database, "-X", "-v", "ON_ERROR_STOP=1", "-f", "backend/schema.sql"]);
  run("bash", ["backend/scripts/migrate.sh", "up"], { ...process.env, DATABASE_URL: database });
  run("psql", [database, "-X", "-v", "ON_ERROR_STOP=1", "-c", "GRANT USAGE ON SCHEMA public TO service_role; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role; NOTIFY pgrst, 'reload schema';"]);
  await new Promise(resolve => setTimeout(resolve, 1500));
  // Spawn asynchronously: the gateway must keep serving while tests run.
  const { spawn } = await import("node:child_process");
  const child = spawn("npm", ["test", "--prefix", "backend"], {
    stdio: "inherit", env: { ...process.env, SUPABASE_TEST_URL: `http://127.0.0.1:${port}`, SUPABASE_TEST_SERVICE_ROLE_KEY: token("service_role"), SUPABASE_TEST_ANON_KEY: token("anon") },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => resolve(code ?? 1)); });
} finally { gateway.closeAllConnections(); gateway.close(); }
