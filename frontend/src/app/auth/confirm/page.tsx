'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
export default function ConfirmAccount() {
  const router = useRouter(); const { refreshSession } = useAuth();
  const [message, setMessage] = useState('Confirming your request…');
  const request = useRef<Promise<Response> | null>(null);
  useEffect(() => {
    let active = true;
    const params = new URL(window.location.href).searchParams;
    request.current ??= fetch('/api/auth/confirm', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token_hash: params.get('token_hash'), type: params.get('type') }) });
    request.current.then(async response => {
      if (!response.ok) throw new Error('This link is invalid or expired. Request a new link.');
      const body = await response.json();
      if (body.pending) { if (active) setMessage('Confirm the link in your other mailbox to finish changing your address.'); return; }
      await refreshSession();
      const next = params.get('next');
      if (active) router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : '/');
    }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [router, refreshSession]);
  return <main className="auth-confirm"><h1>Legal Assistant</h1><p role="status">{message}</p><a href="/login">Back to sign in</a></main>;
}
