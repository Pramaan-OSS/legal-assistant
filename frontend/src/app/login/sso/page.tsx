"use client";
import {useState} from 'react';
import Link from 'next/link';
import {authGlassCardUIClassName} from '@/shared/ui/AuthStylesUI';
import {startOrganizationSignIn} from '@/app/lib/authApi';
export default function OrganizationLogin() {
 const [organization,setOrganization]=useState(''),[connection,setConnection]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <section className={`${authGlassCardUIClassName} connected-apps mx-auto my-10 max-w-md`}><h1>Organization sign-in</h1><p>Use the organization and connection codes shared by your administrator. First link your organization identity while signed in to your existing local account. Your email address does not link accounts.</p><p>OpenID Connect is supported when the service is configured. SAML is unavailable. The sign-in service is not yet deployed or live-verified.</p><form className="remote-connection-form" onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{const result=await startOrganizationSignIn(organization.trim(),connection.trim());window.location.assign(result.url);}catch{setError('Organization sign-in is unavailable. Check the codes or use local sign-in.');setBusy(false);}}}><label>Organization code<input required value={organization} onChange={e=>setOrganization(e.target.value)} disabled={busy}/></label><label>Connection code<input required value={connection} onChange={e=>setConnection(e.target.value)} disabled={busy}/></label><button disabled={busy||!organization.trim()||!connection.trim()}>Continue organization sign-in</button></form>{error&&<p role="alert">{error}</p>}<Link href="/login">Use local sign-in</Link></section>;
}
