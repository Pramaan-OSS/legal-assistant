'use client';
import { useEffect, useRef, useState } from 'react';
import { finishManagedSignIn } from '@/app/lib/managedSignIn';
export default function ManagedReturn() {
 const started=useRef(false);const [error,setError]=useState(false);
 useEffect(()=>{if(started.current)return;started.current=true;
 void finishManagedSignIn().then(()=>window.location.replace('/assistant')).catch(()=>setError(true));
 },[]);
 return <main className="p-8 text-center">{error?<><p>Managed sign-in could not finish. Start sign-in again.</p><a href="/login">Back to sign-in</a></>:<p>Finishing sign-in…</p>}</main>;
}
