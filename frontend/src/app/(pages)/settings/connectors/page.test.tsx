import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectedApps from './page';
const api = vi.hoisted(() => ({ listMcpConnectors: vi.fn(), createMcpConnector: vi.fn(), startMcpConnectorOAuth: vi.fn(), refreshMcpConnectorTools: vi.fn(), updateMcpConnector: vi.fn(), deleteMcpConnector: vi.fn(), setMcpToolEnabled: vi.fn(), needsMfaVerification: vi.fn() }));
vi.mock('@/app/lib/legalAssistantApi', () => ({ ...api, isMfaRequiredError: () => false }));
vi.mock('@/app/components/popups/MfaVerificationPopup', () => ({ needsMfaVerification: api.needsMfaVerification, MfaVerificationPopup: ({open, onVerified}: {open: boolean; onVerified: () => void}) => open ? <button onClick={onVerified}>Verify locally</button> : null }));
const row = () => ({ id: 'owned', serverUrl: 'app:files', enabled: true, readOnly: false, oauthConnected: true, tools: [{id: 'read', title: 'Read item', enabled: true, write: false}, {id: 'write', title: 'Update item', enabled: true, write: true}] });
beforeEach(() => { vi.clearAllMocks(); api.listMcpConnectors.mockResolvedValue([row()]); api.needsMfaVerification.mockResolvedValue(false); api.refreshMcpConnectorTools.mockReset().mockResolvedValue({ ...row(), discovery: { query: 'download file' } }); });
describe('Connected apps', () => {
 it('shows seven neutral connection cards and requires review for writes', async () => { render(<ConnectedApps/>); await screen.findByText('Read item'); for (const name of ['Files', 'Mail', 'Calendar', 'Team chat', 'Notes', 'Tables', 'Work tracking']) expect(screen.getByRole('heading', {name})).toBeVisible(); expect(screen.getByText('Update item · review required')).toBeVisible(); expect(screen.queryByPlaceholderText(/server url/i)).toBeNull(); });
 it('saves read-only mode against the owned connector', async () => { render(<ConnectedApps/>); await screen.findByText('Read item'); fireEvent.click(screen.getByLabelText('Limit this app to verified read actions')); await waitFor(() => expect(api.updateMcpConnector).toHaveBeenCalledWith('owned', {readOnly: true})); });
 it('disables write controls in read-only mode while retaining reads', async () => { api.listMcpConnectors.mockResolvedValue([{...row(), readOnly: true}]); render(<ConnectedApps/>); expect(await screen.findByLabelText('Update item · review required')).toBeDisabled(); expect(screen.getByLabelText('Read item')).toBeEnabled(); });
 it('waits for two-factor verification before making a change', async () => { api.needsMfaVerification.mockResolvedValue(true); render(<ConnectedApps/>); await screen.findByText('Read item'); fireEvent.click(screen.getByLabelText('Limit this app to verified read actions')); await screen.findByText('Verify locally'); expect(api.updateMcpConnector).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Verify locally')); await waitFor(() => expect(api.updateMcpConnector).toHaveBeenCalledWith('owned', {readOnly: true})); });
 it('shows a safe failed refresh message', async () => { api.refreshMcpConnectorTools.mockRejectedValue(new Error('private vendor token')); render(<ConnectedApps/>); await screen.findByText('Read item'); fireEvent.change(screen.getByLabelText('Search actions for Files'), { target: { value: 'find file' } }); fireEvent.click(screen.getAllByText('Search actions')[0]); expect(await screen.findByRole('alert')).toHaveTextContent('Check its status'); expect(screen.queryByText(/private vendor token/)).toBeNull(); });
});

it('searches an owned connection by keyword without exposing action keys', async () => {
 render(<ConnectedApps/>); await screen.findByText('Read item');
 expect(screen.getAllByText('Search actions')[0]).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Search actions for Files'), { target: { value: '  download file  ' } });
 fireEvent.click(screen.getAllByText('Search actions')[0]);
 await waitFor(() => expect(api.refreshMcpConnectorTools).toHaveBeenCalledWith('owned', 'download file', undefined));
 expect(screen.getByText(/New search pages use paid requests/)).toBeVisible();
});

it('explains consent access and link expiry before connecting', async () => {
 render(<ConnectedApps/>); await screen.findByText('Read item');
 expect(screen.getByText(/access shown on the consent screen/)).toBeVisible();
 expect(screen.getByText(/does not narrow the consent request/)).toBeVisible();
 expect(screen.getByText(/about 10 minutes/)).toBeVisible();
});

it('renders account access and app usage before starting the hosted connection', async () => {
 api.startMcpConnectorOAuth.mockImplementation(async () => {
  const card = screen.getByRole('heading', { name: 'Files' }).closest('article')!;
  expect(within(card).getByText(/read, change, share and delete every file/)).toBeVisible();
  expect(within(card).getByText(/uses only the actions you enable/)).toBeVisible();
  return { authorizationUrl: null };
 });
 render(<ConnectedApps/>); await screen.findByText('Read item');
 const card = screen.getByRole('heading', { name: 'Files' }).closest('article')!;
 fireEvent.click(within(card).getByRole('button', { name: 'Reconnect' }));
 await waitFor(() => expect(api.startMcpConnectorOAuth).toHaveBeenCalledWith('owned'));
});

it('loads another page only when requested and reuses the completed search for the session', async () => {
 api.refreshMcpConnectorTools.mockResolvedValueOnce({ ...row(), discovery: { query: 'note', nextCursor: 'page-two' } }).mockResolvedValueOnce({ ...row(), discovery: { query: 'note' } });
 render(<ConnectedApps/>); await screen.findByText('Read item');
 fireEvent.change(screen.getByLabelText('Search actions for Files'), { target: { value: 'note' } });
 fireEvent.click(screen.getAllByText('Search actions')[0]);
 const more = await screen.findByText('Load more actions'); expect(api.refreshMcpConnectorTools).toHaveBeenCalledTimes(1);
 fireEvent.click(more); await screen.findByText('All results for this search are loaded.');
 expect(api.refreshMcpConnectorTools).toHaveBeenLastCalledWith('owned', 'note', 'page-two');
 expect(screen.queryByText('Load more actions')).toBeNull();
 fireEvent.click(screen.getAllByText('Search actions')[0]); expect(api.refreshMcpConnectorTools).toHaveBeenCalledTimes(2);
});

it('adds an owned remote service without allowing custom headers and shows its consent before sign-in', async () => {
 api.createMcpConnector.mockResolvedValue({connector:{id:'remote-owned'},oauthRequired:false});
 render(<ConnectedApps/>); await screen.findByText('Read item');
 expect(screen.getByText(/Its actions may read, change, send or delete/)).toBeVisible();
 expect(screen.getByText(/Custom credential headers, token entry/)).toBeVisible();
 fireEvent.change(screen.getByLabelText('Remote service address'),{target:{value:'https://service.example/mcp'}});
 fireEvent.change(screen.getByLabelText('Remote sign-in'),{target:{value:'none'}});
 fireEvent.click(screen.getByRole('button',{name:'Add remote service'}));
 await waitFor(()=>expect(api.createMcpConnector).toHaveBeenCalledWith({name:'Remote service',serverUrl:'https://service.example/mcp',authType:'none'}));
});
