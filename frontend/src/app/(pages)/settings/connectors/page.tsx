'use client';
import { MfaVerificationPopup, needsMfaVerification } from '@/app/components/popups/MfaVerificationPopup';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isMfaRequiredError, listMcpConnectors, createMcpConnector, startMcpConnectorOAuth, refreshMcpConnectorTools, updateMcpConnector, deleteMcpConnector, setMcpToolEnabled, type McpConnectorSummary } from '@/app/lib/legalAssistantApi';
import { connectedAppChoices, connectedAppAccessNotice } from '@/shared/lib/connectedAppAccess';
export default function ConnectedApps() {
 const [remoteAddress, setRemoteAddress] = useState('');
 const [remoteAuth, setRemoteAuth] = useState<'none' | 'oauth'>('oauth');
 const pages = useRef(new Map<string, { query: string; nextCursor?: string }>());
 const [shownPages, setShownPages] = useState<Record<string, { query: string; nextCursor?: string }>>({});
 const [queries, setQueries] = useState<Record<string, string>>({});
 const [pending, setPending] = useState<(() => Promise<unknown>) | null>(null);
 const [items, setItems] = useState<McpConnectorSummary[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
 const load = useCallback(async () => { try { setItems(await listMcpConnectors()); } catch { setError('Connections could not be loaded. Try again.'); } }, []);
 useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [load]);
 async function action(work: () => Promise<unknown>, verified = false) { setBusy(true); setError(''); try { if (!verified && await needsMfaVerification()) { setPending(() => work); return; } await work(); await load(); } catch (error) { if (isMfaRequiredError(error)) setPending(() => work); else setError('This connection could not complete. Check its status before trying again.'); } finally { setBusy(false); } }
 async function discover(row: McpConnectorSummary, query: string, cursor?: string) {
  const cacheKey = JSON.stringify([row.id, row.updatedAt, query]);
  const cached = pages.current.get(cacheKey);
  if (cursor === undefined && cached) { setShownPages(previous => ({ ...previous, [row.id]: cached })); return; }
  await action(async () => {
   let result: McpConnectorSummary;
   try { result = await refreshMcpConnectorTools(row.id, query, cursor); }
   catch (error) { pages.current.delete(cacheKey); setShownPages(previous => { const next = { ...previous }; delete next[row.id]; return next; }); throw error; }
   const page = { query, ...(result?.discovery?.nextCursor ? { nextCursor: result.discovery.nextCursor } : {}) };
   pages.current.set(cacheKey, page); setShownPages(previous => ({ ...previous, [row.id]: page }));
  });
 }
 async function connect(key: string, name: string) {
  await action(async () => {
   let row = items.find(c => c.serverUrl === `app:${key}`);
   if (!row) row = (await createMcpConnector({ name, serverUrl: `app:${key}` })).connector;
   const result = await startMcpConnectorOAuth(row.id);
   if (result.authorizationUrl) window.location.assign(result.authorizationUrl);
  });
 }
 return <section className="connected-apps"><h1>Connected apps</h1><p>Connect an account, then search for an action by keyword. Load another page only when you need more actions. New search pages use paid requests; pages already loaded in this session are reused. Create, change, send and delete actions wait for your review in the assistant. You can limit actions here to verified reads.</p>
  <p>The connection service chooses the access shown on the consent screen. This app cannot narrow that access; limiting actions here does not narrow the consent request. Sign-in links last about 10 minutes.</p>
  {error && <p role="alert">{error}</p>}
  <div className="connection-grid">{connectedAppChoices.map(([key, name, slug]) => { const row = items.find(c => c.serverUrl === `app:${key}`); return <article key={key} className="connection-card"><h2>{name}</h2><p>{row?.oauthConnected ? 'Connected' : 'Not connected'}</p>
   <p>{connectedAppAccessNotice(slug)}</p><button disabled={busy} onClick={() => void connect(key, name)}>{row?.oauthConnected ? 'Reconnect' : 'Connect'}</button>
   {row && <><form onSubmit={e => { e.preventDefault(); const query = queries[row.id]?.trim(); if (query) void discover(row, query); }}>
    <label>Search actions for {name}<input type="search" value={queries[row.id] ?? ''} maxLength={2000} disabled={busy || !row.oauthConnected} onChange={e => setQueries(prev => ({ ...prev, [row.id]: e.target.value }))} placeholder="Enter an action keyword" /></label>
    <button type="submit" disabled={busy || !row.oauthConnected || !queries[row.id]?.trim()}>Search actions</button>
   </form>
    {shownPages[row.id]?.query === queries[row.id]?.trim() && (shownPages[row.id]?.nextCursor
      ? <button disabled={busy || !row.oauthConnected} onClick={() => void discover(row, shownPages[row.id].query, shownPages[row.id].nextCursor)}>Load more actions</button>
      : <p>All results for this search are loaded.</p>)}
    <label><input type="checkbox" checked={row.enabled} disabled={busy} onChange={e => { const enabled = e.target.checked; void action(() => updateMcpConnector(row.id, { enabled })); }}/> Enabled</label>
    <label><input type="checkbox" checked={!!row.readOnly} disabled={busy} onChange={e => { const readOnly = e.target.checked; void action(() => updateMcpConnector(row.id, { readOnly })); }}/> Limit this app to verified read actions</label>
    <button disabled={busy} onClick={() => { if (window.confirm('Disconnect this account and remove its actions?')) void action(() => deleteMcpConnector(row.id)); }}>Disconnect</button>
    <ul>{row.tools.map(tool => <li key={tool.id}><label><input type="checkbox" checked={tool.enabled} disabled={busy || (!!row.readOnly && tool.write)} onChange={e => { const enabled = e.target.checked; void action(() => setMcpToolEnabled(row.id, tool.id, enabled)); }}/>{tool.title ?? 'Connected action'}{tool.write ? ' · review required' : ''}</label></li>)}</ul>
    {row.oauthConnected && !row.tools.length && <p>No actions loaded. Search by keyword to find available actions and their input fields.</p>}
   </>}
  </article>; })}</div>
  <MfaVerificationPopup open={!!pending} onCancel={() => setPending(null)} onVerified={() => { const work = pending; setPending(null); if (work) void action(work, true); }}/>
  <h2>Remote services</h2>
  <p>Connecting gives this app access to your account with the permissions shown on the service’s consent screen. Its actions may read, change, send or delete data. This app runs only actions you enable, and every remote action waits for your approval. The service may charge your account.</p>
  <p>Sign-in is kept encrypted by the connection service. Disconnecting removes it there, but may leave the grant at the remote service; you can remove that grant in its account settings. Sign-in links work once for ten minutes. If a link expires or this app restarts, remove the pending connection and add its address again.</p>
  <form className="remote-connection-form" onSubmit={e => { e.preventDefault(); void action(async () => { const created = await createMcpConnector({ name: 'Remote service', serverUrl: remoteAddress.trim(), authType: remoteAuth }); setRemoteAddress(''); if (created.oauthRequired) { const link = await startMcpConnectorOAuth(created.connector.id); if (link.authorizationUrl) window.location.assign(link.authorizationUrl); } }); }}>
   <label>Remote service address<input type="url" required maxLength={2048} value={remoteAddress} onChange={e => setRemoteAddress(e.target.value)} placeholder="https://service.example/mcp" disabled={busy}/></label>
   <label>Remote sign-in<select value={remoteAuth} onChange={e => setRemoteAuth(e.target.value as 'none' | 'oauth')} disabled={busy}><option value="oauth">Hosted sign-in</option><option value="none">No sign-in needed</option></select></label>
   <button disabled={busy || !remoteAddress.trim()}>Add remote service</button>
  </form>
  <p>Use a public HTTPS address on port 443. Custom credential headers, token entry, manual sign-in clients, other transports, file transfers and streamed action results are unavailable. For a specialist service, supply its own address; none is bundled.</p>
  {items.filter(row => row.serverUrl === 'remote:').map(row => <article className="connection-card" key={row.id}>
   <h3>Remote service</h3><p>{row.oauthConnected ? 'Connected' : 'Sign-in pending or connection failed. Check its status, or remove it and add the address again.'}</p>
   {!row.oauthConnected && row.authType === 'oauth' && <button disabled={busy} onClick={() => void action(async () => { const link = await startMcpConnectorOAuth(row.id); if (link.authorizationUrl) window.location.assign(link.authorizationUrl); })}>Continue remote sign-in</button>}
   <button disabled={busy || !row.oauthConnected} onClick={() => void discover(row, 'Remote actions')}>Load remote actions</button>
   {shownPages[row.id]?.nextCursor && <button disabled={busy || !row.oauthConnected} onClick={() => void discover(row,'Remote actions',shownPages[row.id].nextCursor)}>Load more remote actions</button>}
   <label><input type="checkbox" checked={row.enabled} disabled={busy} onChange={e => { const enabled = e.target.checked; void action(() => updateMcpConnector(row.id,{enabled})); }}/> Enable remote service</label>
   <label><input type="checkbox" checked={!!row.readOnly} disabled={busy} onChange={e => { const readOnly = e.target.checked; void action(() => updateMcpConnector(row.id,{readOnly})); }}/> Limit remote service to reads</label>
   <p>Remote services do not verify which actions only read. Limiting to reads blocks all remote actions; approval is always required.</p>
   <ul>{row.tools.map(tool => <li key={tool.id}><label><input type="checkbox" checked={tool.enabled} disabled={busy || !!row.readOnly} onChange={e => { const enabled = e.target.checked; void action(() => setMcpToolEnabled(row.id,tool.id,enabled)); }}/>{tool.title ?? 'Remote action'} · review required</label><p>{tool.description}</p></li>)}</ul>
   <button disabled={busy} onClick={() => { if (window.confirm('Disconnect this remote service? Existing actions at the service are not undone.')) void action(() => deleteMcpConnector(row.id)); }}>Disconnect remote service</button>
  </article>)}
 </section>;
}
