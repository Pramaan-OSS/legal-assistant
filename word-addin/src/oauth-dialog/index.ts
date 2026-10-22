import { completeManagedReturn } from '../../../frontend/src/shared/lib/managedReturn';
import { createAuthClient } from 'better-auth/client';
/// <reference types="office-js" />
import {
  GOOGLE_OAUTH_MESSAGE_TYPE,
  type GoogleOAuthDialogMessage,
} from "../taskpane/auth/oauthProtocol";
import { initAddinErrorReporting } from "../taskpane/lib/errorReporting";

initAddinErrorReporting("oauth-dialog");

const API_BASE = (process.env.REACT_APP_API_BASE_URL || "/api").replace(
  /\/+$/,
  "",
);
const REQUEST_STORAGE_KEY = "legal-assistant-word-google-oauth-request";

function setStatus(message: string): void {
  const element = document.getElementById("status");
  if (element) element.textContent = message;
}

function send(message: GoogleOAuthDialogMessage): boolean {
  // No legacy (option-less) retry on failure: dropping targetOrigin would
  // weaken the receiver's origin check (session.ts skips it when the host
  // omits event.origin), and every host this add-in supports has the
  // DialogOrigin 1.1 set. A visible failure beats a weaker handoff.
  try {
    Office.context.ui.messageParent(JSON.stringify(message), {
      targetOrigin: window.location.origin,
    });
    return true;
  } catch {
    setStatus(
      "Could not notify Word that sign-in completed. Close this window and try again.",
    );
    return false;
  }
}

function sendError(requestId: string, message: string): void {
  setStatus(message);
  send({
    type: GOOGLE_OAUTH_MESSAGE_TYPE,
    requestId,
    status: "error",
    message,
  });
}

function clearTemporaryAuthStorage(): void {
  // Sweep up PKCE/session keys left by older older browser builds.
  for (const storage of [window.sessionStorage, window.localStorage]) {
    storage.removeItem("legal-assistant-word-google-oauth");
    storage.removeItem("legal-assistant-word-google-oauth-code-verifier");
  }
  window.sessionStorage.removeItem(REQUEST_STORAGE_KEY);
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    detail?: unknown;
  };
  return typeof body.detail === "string" && body.detail
    ? body.detail
    : `Connected sign-in failed (HTTP ${response.status}).`;
}


const MANAGED_STATE='legal-assistant-word-managed-state';
async function managedSignIn(requestId:string,authUrl:string):Promise<void> {
  if(new URL(authUrl).protocol!=='https:')throw new Error('Managed sign-in is not available yet.');
  const auth=createAuthClient({baseURL:authUrl,fetchOptions:{retry:0}});
  async function start(){const response=await fetch(`${API_BASE}/auth/managed/start`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error('Managed sign-in could not start. Try again.');const {state}=await response.json() as {state:string};sessionStorage.setItem(MANAGED_STATE,state);}
  async function finish(){const state=sessionStorage.getItem(MANAGED_STATE);sessionStorage.removeItem(MANAGED_STATE);if(!state)throw new Error('Start sign-in again.');await completeManagedReturn(query=>auth.$fetch('/get-session',{method:'GET',query}));const proof=await auth.$fetch<{token:string}>('/token',{method:'GET'});if(proof.error||!proof.data?.token)throw new Error('Sign-in could not be verified. Start again.');const response=await fetch(`${API_BASE}/auth/managed/redeem`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,token:proof.data.token,handoffRequestId:requestId})});if(!response.ok)throw new Error('Sign-in could not be verified. Start again.');const body=await response.json() as {handoffTicket?:string};if(!body.handoffTicket||!/^[A-Za-z0-9_-]{32,256}$/.test(body.handoffTicket))throw new Error('Sign-in did not produce a valid return ticket.');clearTemporaryAuthStorage();if(send({type:GOOGLE_OAUTH_MESSAGE_TYPE,requestId,status:'success',handoffTicket:body.handoffTicket}))setStatus('Signed in. You can return to Word.');}
  if(sessionStorage.getItem(MANAGED_STATE)){setStatus('Completing sign-in…');await finish();return;}
  setStatus('Sign in with your managed account.');
  const form=document.getElementById('managed-email') as HTMLFormElement;form.hidden=false;
  const social=document.getElementById('managed-social') as HTMLButtonElement;social.hidden=false;
  const failed=()=>setStatus('Sign-in could not finish. Check your details and try again.');
  form.addEventListener('submit',event=>{event.preventDefault();void(async()=>{await start();const values=new FormData(form);const result=await auth.signIn.email({email:String(values.get('email')),password:String(values.get('password'))});if(result.error){sessionStorage.removeItem(MANAGED_STATE);failed();return;}await finish();})().catch(()=>{sessionStorage.removeItem(MANAGED_STATE);failed();});});
  social.addEventListener('click',()=>{void(async()=>{await start();const result=await auth.signIn.social({provider:'google',callbackURL:window.location.href});if(result.error){sessionStorage.removeItem(MANAGED_STATE);failed();}})().catch(()=>{sessionStorage.removeItem(MANAGED_STATE);failed();});});
}

async function runGoogleOAuth(): Promise<void> {
  const currentUrl = new URL(window.location.href);
  const requestedId = currentUrl.searchParams.get("requestId");
  if (requestedId) {
    window.sessionStorage.setItem(REQUEST_STORAGE_KEY, requestedId);
  }
  const requestId =
    requestedId ?? window.sessionStorage.getItem(REQUEST_STORAGE_KEY) ?? "";
  if (!requestId) {
    setStatus(
      "This sign-in request is invalid. Close this window and try again.",
    );
    return;
  }

  const optionsResponse=await fetch(`${API_BASE}/auth/options`,{credentials:'include'});
  if(!optionsResponse.ok)throw new Error('Sign-in is not available yet. Try again later.');
  const options=await optionsResponse.json() as {managed?:boolean;authUrl?:string;socialSignIn?:boolean};
  if(options.managed && options.authUrl){await managedSignIn(requestId,options.authUrl);return;}
  if(!options.socialSignIn){sendError(requestId,'Connected sign-in is not available yet. Use a local account.');return;}

  const providerError =
    currentUrl.searchParams.get("error_description") ??
    currentUrl.searchParams.get("error");
  if (providerError) {
    clearTemporaryAuthStorage();
    sendError(requestId, "Connected sign-in did not complete. Start again.");
    return;
  }

  const code = currentUrl.searchParams.get("code");
  if (code) {
    setStatus("Completing sign-in…");
    const response = await fetch(`${API_BASE}/auth/exchange`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state: currentUrl.searchParams.get("state"), handoffRequestId: requestId }),
    });
    if (!response.ok) {
      const message = await responseError(response);
      clearTemporaryAuthStorage();
      sendError(requestId, message);
      return;
    }

    const data = (await response.json()) as { handoffTicket?: unknown };
    if (
      typeof data.handoffTicket !== "string" ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(data.handoffTicket)
    ) {
      clearTemporaryAuthStorage();
      sendError(requestId, "Connected sign-in did not produce a valid handoff.");
      return;
    }

    const message: GoogleOAuthDialogMessage = {
      type: GOOGLE_OAUTH_MESSAGE_TYPE,
      requestId,
      status: "success",
      handoffTicket: data.handoffTicket,
    };
    clearTemporaryAuthStorage();
    if (send(message)) {
      setStatus("Signed in. You can return to Word.");
    }
    return;
  }

  const response = await fetch(`${API_BASE}/auth/oauth`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "google",
      callbackPath: "/oauth-dialog.html",
      next: "/assistant",
    }),
  });
  if (!response.ok) {
    const message = await responseError(response);
    clearTemporaryAuthStorage();
    sendError(requestId, message);
    return;
  }
  const data = (await response.json()) as { url?: string };
  if (!data.url) {
    clearTemporaryAuthStorage();
    sendError(requestId, "Unable to open Connected sign-in.");
    return;
  }

  window.location.assign(data.url);
}

Office.onReady(() => {
  void runGoogleOAuth().catch((error: unknown) => {
    const requestId =
      new URL(window.location.href).searchParams.get("requestId") ??
      window.sessionStorage.getItem(REQUEST_STORAGE_KEY);
    const message =
      error instanceof Error
        ? error.message
        : "Unable to complete Connected sign-in.";
    if (requestId) {
      sendError(requestId, message);
    } else {
      setStatus(message);
    }
  });
});
