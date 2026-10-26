import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "./page";

const { getAuthSession, updateAuthPassword, searchParams } = vi.hoisted(() => ({
    getAuthSession: vi.fn(),
    updateAuthPassword: vi.fn(),
    searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
    useSearchParams: () => searchParams,
}));

vi.mock("@/app/lib/authApi", () => ({ getAuthSession, updateAuthPassword }));

vi.mock("@/app/components/site-logo", () => ({
    SiteLogo: () => <div>Legal Assistant</div>,
}));

async function submitPassword(password: string) {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("New password"), password);
    await user.type(screen.getByLabelText("Confirm new password"), password);
    await user.click(screen.getByRole("button", { name: "Update password" }));
    return user;
}

describe("ResetPasswordPage", () => {
    beforeEach(() => {
        getAuthSession.mockReset();
        updateAuthPassword.mockReset();
        getAuthSession.mockResolvedValue({ id: "user-1" });
    });

    it("says what is wrong with a password the server rejects", async () => {
        updateAuthPassword.mockRejectedValue(
            Object.assign(new Error("Password is too weak"), {
                status: 422,
                code: "weak_password",
            }),
        );
        render(<ResetPasswordPage />);

        await submitPassword("correct-horse-battery");

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Choose a stronger password: at least 10 characters, mixing letters, numbers, and symbols.",
        );
    });

    it("refuses a password past bcrypt's limit before calling the API", async () => {
        render(<ResetPasswordPage />);

        await submitPassword("x".repeat(73));

        expect(updateAuthPassword).not.toHaveBeenCalled();
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Password must be at most 72 UTF-8 bytes. Accented characters and emoji can use more than one byte.",
        );
    });

    it("blames the connection, not the link, when the request never lands", async () => {
        getAuthSession.mockRejectedValue(new TypeError("Failed to fetch"));
        render(<ResetPasswordPage />);

        expect(
            await screen.findByText(
                "Legal Assistant couldn't reach the server. Check your connection and try again.",
            ),
        ).toBeInTheDocument();
    });

    it("still calls a spent link spent", async () => {
        getAuthSession.mockRejectedValue(
            Object.assign(new Error("Session not found"), { status: 401 }),
        );
        render(<ResetPasswordPage />);

        expect(
            await screen.findByText(
                "This password-reset link is invalid or has expired.",
            ),
        ).toBeInTheDocument();
    });
});

it('managed reset removes its token once without repeating the page update', async () => {
 const auth = { resetPassword: vi.fn().mockResolvedValue({data:{},error:null}) };
 vi.doMock('better-auth/client',()=>({createAuthClient:()=>auth}));
 const config=document.createElement('script');config.id='managed-auth-config';config.type='application/json';config.textContent=JSON.stringify({authUrl:'https://signin.example.test/api/auth',recoveryEnabled:true});document.body.append(config);
 searchParams.set('managed','1');searchParams.set('token','one-use-fixture');history.replaceState(null,'','/reset-password?managed=1&token=one-use-fixture');
 const replace=vi.spyOn(history,'replaceState');getAuthSession.mockClear();updateAuthPassword.mockClear();
 const view=render(<ResetPasswordPage/>);
 try {
  await submitPassword('New-private-password-2948');
  expect(await screen.findByRole('heading',{name:'Password updated'})).toBeVisible();
  expect(replace).toHaveBeenCalledTimes(1);expect(location.search).not.toContain('token');
  expect(getAuthSession).not.toHaveBeenCalled();expect(updateAuthPassword).not.toHaveBeenCalled();
 } finally {view.unmount();replace.mockRestore();config.remove();searchParams.delete('managed');searchParams.delete('token');history.replaceState(null,'','/');vi.doUnmock('better-auth/client');}
});
