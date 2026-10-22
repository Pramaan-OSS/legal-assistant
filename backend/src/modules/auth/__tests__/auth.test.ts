import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authClient,
  createRequestSupabase,
  clearRequestAuthCookies,
  issueAuthHandoff,
  consumeAuthHandoff,
} = vi.hoisted(() => ({
  authClient: {
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
      signInWithSSO: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      signOut: vi.fn(),
      setSession: vi.fn(),
      mfa: {
        verify: vi.fn(),
        challengeAndVerify: vi.fn(),
      },
    },
  },
  createRequestSupabase: vi.fn(),
  clearRequestAuthCookies: vi.fn(),
  issueAuthHandoff: vi.fn(),
  consumeAuthHandoff: vi.fn(),
}));

vi.mock("../../../lib/authSession", () => ({
  createRequestSupabase,
  clearRequestAuthCookies,
  publicAuthUser: (user: {
    id: string;
    email?: string;
    new_email?: string;
    app_metadata?: { provider?: string };
  }) => ({
    id: user.id,
    email: user.email ?? "",
    pendingEmail: user.new_email ?? null,
    createdWithGoogle: user.app_metadata?.provider === "google",
  }),
}));
vi.mock("../../../lib/authHandoff", () => ({
  issueAuthHandoff,
  consumeAuthHandoff,
}));
vi.mock("../../../middleware/auth", () => ({
  requireAuth: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
  ) => {
    res.locals.authClient = authClient;
    res.locals.authSource = "cookie";
    next();
  },
}));

import { authRouter } from "../auth.routes";
import { signupSchema } from "../auth.service";

const app = express();
app.use(express.json());
app.use("/auth", authRouter);

const origin = "https://app.example.test";
const user = { id: "user-1", email: "lawyer@example.test" };
const session = { access_token: "server-only-token" };
const wordOrigin = "https://word.example.test";

describe("auth routes", () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = origin;
    process.env.NODE_ENV = "production";
    delete process.env.WORD_ADDIN_URL;
    for (const key of ["SSO_ENABLED", "SSO_ALLOWED_DOMAINS"])
      delete process.env[key];
    createRequestSupabase.mockReset().mockReturnValue(authClient);
    clearRequestAuthCookies.mockReset();
    issueAuthHandoff.mockReset();
    consumeAuthHandoff.mockReset();
    for (const method of Object.values(authClient.auth)) {
      if (typeof method === "function") method.mockReset();
    }
    for (const method of Object.values(authClient.auth.mfa)) {
      method.mockReset();
    }
  });

  it("rejects an auth mutation from an untrusted origin", async () => {
    const response = await request(app)
      .post("/auth/login")
      .set("Origin", "https://attacker.example")
      .send({ email: "lawyer@example.test", password: "correct horse" });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("untrusted_origin");
    expect(createRequestSupabase).not.toHaveBeenCalled();
  });

  it("establishes a server session without returning tokens", async () => {
    authClient.auth.signInWithPassword.mockResolvedValue({
      data: { user, session },
      error: null,
    });

    const response = await request(app)
      .post("/auth/login")
      .set("Origin", origin)
      .send({ email: user.email, password: "correct horse" });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toEqual({
      user: {
        id: user.id,
        email: user.email,
        pendingEmail: null,
        createdWithGoogle: false,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("server-only-token");
  });



















  it("translates a provider login failure into our own sentence", async () => {
    authClient.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: {
        status: 400,
        code: "invalid_credentials",
        message: "Invalid login credentials (gotrue internal id 42)",
      },
    });

    const response = await request(app)
      .post("/auth/login")
      .set("Origin", origin)
      .send({ email: user.email, password: "wrong horse" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: "invalid_credentials",
      detail: "The email or password is incorrect.",
    });
    expect(response.text).not.toContain("gotrue internal");
  });

  it("rejects an over-long password with a specific message before calling the provider", async () => {
    const response = await request(app)
      .post("/auth/signup")
      .set("Origin", origin)
      .send({ email: user.email, password: "x".repeat(73) });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: "password_too_long",
      detail: "Password must be at most 72 UTF-8 bytes. Accented characters and emoji can use more than one byte.",
    });
    expect(authClient.auth.signUp).not.toHaveBeenCalled();
  });

  it("counts bcrypt's 72-byte limit in bytes, not characters", async () => {
    // 36 two-byte characters: 36 long by String.length, 72 bytes to bcrypt,
    // so this one is legal. A `.max(72)` on characters would instead let
    // its 37-character sibling through for GoTrue to reject.
    const atTheLimit = "é".repeat(36);
    const overTheLimit = "é".repeat(37);
    expect(atTheLimit.length).toBe(36);
    expect(signupSchema.safeParse({ email: user.email, password: atTheLimit }).success).toBe(true);

    const response = await request(app)
      .post("/auth/signup")
      .set("Origin", origin)
      .send({ email: user.email, password: overTheLimit });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: "password_too_long",
      detail: "Password must be at most 72 UTF-8 bytes. Accented characters and emoji can use more than one byte.",
    });
    expect(authClient.auth.signUp).not.toHaveBeenCalled();
  });

  it("enforces the sign-up minimum length on the API, not only in the form", async () => {
    const response = await request(app)
      .post("/auth/signup")
      .set("Origin", origin)
      .send({ email: user.email, password: "eightch8" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: "password_too_short",
      detail: "Password must be at least 10 characters.",
    });
    expect(authClient.auth.signUp).not.toHaveBeenCalled();
  });

  it("names a too-short password on password update", async () => {
    const response = await request(app)
      .patch("/auth/password")
      .set("Origin", origin)
      .send({ password: "short" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: "password_too_short",
      detail: "Password must be at least 10 characters.",
    });
  });

  // Sign-in must accept any password the account might already have: one
  // set under main's old 8-character rule, one set before GoTrue began
  // refusing >72 bytes (bcrypt compared only the first 72), or one created
  // through the Supabase dashboard/admin API, which skip our forms. The
  // provider is the only judge of whether it matches.
  it.each([
    ["an 8-character password set under the old rule", "eightch8"],
    ["a 1-character password created by an admin", "x"],
    ["an 80-byte ASCII password set before the 72-byte cap", "a".repeat(80)],
    ["a 19-emoji (76-byte) password", "\u{1F600}".repeat(19)],
  ])("lets sign-in through with %s", async (_label, password) => {
    authClient.auth.signInWithPassword.mockResolvedValue({
      data: { user, session },
      error: null,
    });

    const response = await request(app)
      .post("/auth/login")
      .set("Origin", origin)
      .send({ email: user.email, password });

    expect(response.status).toBe(200);
    expect(authClient.auth.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ password }),
    );
  });

  // bcrypt counts bytes. Each row is exactly 72 bytes (legal) and its
  // one-more sibling (illegal), across 1-, 2-, 3- and 4-byte UTF-8.
  it.each([
    ["ASCII", "a", 72],
    ["2-byte Latin (é)", "é", 36],
    ["3-byte CJK (密)", "密", 24],
    ["4-byte emoji (😀), 2 UTF-16 units each", "\u{1F600}", 18],
  ])("puts the sign-up byte boundary at 72 for %s", (_label, unit, count) => {
    const atLimit = unit.repeat(count);
    const overLimit = unit.repeat(count + 1);
    expect(Buffer.byteLength(atLimit, "utf8")).toBe(72);
    expect(
      signupSchema.safeParse({ email: user.email, password: atLimit }).success,
    ).toBe(true);
    const over = signupSchema.safeParse({ email: user.email, password: overLimit });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.code).toBe("too_big");
  });

  it("counts a decomposed accent (e + U+0301) as the 3 bytes it is", () => {
    // Looks like 24 "é" but is 24 × (1 + 2) = 72 bytes; one more is 75.
    const decomposed = "é";
    expect(
      signupSchema.safeParse({ email: user.email, password: decomposed.repeat(24) })
        .success,
    ).toBe(true);
    expect(
      signupSchema.safeParse({ email: user.email, password: decomposed.repeat(25) })
        .success,
    ).toBe(false);
  });

  it("does not reveal whether a password-reset email exists", async () => {
    authClient.auth.resetPasswordForEmail.mockRejectedValue(
      new Error("account not found"),
    );

    const response = await request(app)
      .post("/auth/password-reset")
      .set("Origin", origin)
      .send({ email: "unknown@example.test" });

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
  });

  it("always clears local cookies during logout", async () => {
    authClient.auth.signOut.mockRejectedValue(
      new Error("upstream unavailable"),
    );

    const response = await request(app)
      .post("/auth/logout")
      .set("Origin", origin)
      .send({ scope: "local" });

    expect(response.status).toBe(204);
    expect(clearRequestAuthCookies).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "/auth/mfa/verify",
      "verify",
      { challengeId: "22222222-2222-4222-8222-222222222222" },
    ],
    ["/auth/mfa/challenge-and-verify", "challengeAndVerify", {}],
  ] as const)(
    "does not expose tokens from %s",
    async (path, method, extraBody) => {
      authClient.auth.mfa[method].mockResolvedValue({
        data: {
          access_token: "mfa-access-token",
          refresh_token: "mfa-refresh-token",
          user,
        },
        error: null,
      });

      const response = await request(app)
        .post(path)
        .set("Origin", origin)
        .send({
          factorId: "11111111-1111-4111-8111-111111111111",
          code: "123456",
          ...extraBody,
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: {
          id: user.id,
          email: user.email,
          pendingEmail: null,
          createdWithGoogle: false,
        },
      });
      expect(JSON.stringify(response.body)).not.toContain("mfa-access-token");
      expect(JSON.stringify(response.body)).not.toContain("mfa-refresh-token");
    },
  );

  it("exchanges Word OAuth sessions for an opaque handoff ticket", async () => {
    process.env.WORD_ADDIN_URL = wordOrigin;
    authClient.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user, session },
      error: null,
    });
    issueAuthHandoff.mockResolvedValue("a".repeat(43));

    const response = await request(app)
      .post("/auth/exchange")
      .set("Origin", wordOrigin)
      .send({ code: "oauth-code", handoffRequestId: "request-id-123456" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ handoffTicket: "a".repeat(43) });
    expect(JSON.stringify(response.body)).not.toContain("server-only-token");
    expect(issueAuthHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        requestId: "request-id-123456",
        origin: wordOrigin,
        session,
      }),
    );
  });

  it("redeems a Word handoff into an HttpOnly session without returning tokens", async () => {
    process.env.WORD_ADDIN_URL = wordOrigin;
    consumeAuthHandoff.mockResolvedValue({
      userId: user.id,
      accessToken: "handoff-access-token",
      refreshToken: "handoff-refresh-token",
    });
    authClient.auth.setSession.mockResolvedValue({
      data: { user, session },
      error: null,
    });

    const response = await request(app)
      .post("/auth/handoff")
      .set("Origin", wordOrigin)
      .send({ ticket: "b".repeat(43), requestId: "request-id-123456" });

    expect(response.status).toBe(200);
    expect(authClient.auth.setSession).toHaveBeenCalledWith({
      access_token: "handoff-access-token",
      refresh_token: "handoff-refresh-token",
    });
    expect(response.body).toEqual({
      user: {
        id: user.id,
        email: user.email,
        pendingEmail: null,
        createdWithGoogle: false,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("handoff-access-token");
    expect(JSON.stringify(response.body)).not.toContain(
      "handoff-refresh-token",
    );
  });
  it.each(['/email','/password'])('refuses local credential changes for a managed identity: %s',async path=>{
    const managed=express();managed.use(express.json());managed.use((_req,res,next)=>{res.locals.managedSignIn=true;next();});managed.use('/auth',authRouter);
    const response=await request(managed).patch('/auth'+path).set('Origin',origin).send({email:'new@example.test',password:'New-password-123!'});
    expect(response.status).toBe(409);expect(response.body.code).toBe('managed_credentials_unavailable');
  });

});
