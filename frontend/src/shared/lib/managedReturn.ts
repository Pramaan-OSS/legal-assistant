/** Finish the managed callback cookie before asking for its session token. */
export async function completeManagedReturn(confirm: (query: Record<string, string>) => Promise<{ error?: unknown }>): Promise<void> {
 const address=new URL(window.location.href);
 const key='neon_auth_session_verifier';
 const verifier=address.searchParams.get(key);
 if(!verifier)return;
 try {
  const result=await confirm({[key]:verifier});
  if(result.error)throw new Error('Sign-in could not be verified. Start again.');
 } finally {
  address.searchParams.delete(key);
  window.history.replaceState(window.history.state,'',address.pathname+address.search+address.hash);
 }
}
