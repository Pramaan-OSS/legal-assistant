import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const start=vi.hoisted(()=>vi.fn());vi.mock('@/app/lib/authApi',()=>({startOrganizationSignIn:start}));
import Page from './page';
beforeEach(()=>{start.mockReset().mockRejectedValue(new Error('Private issuer details'));});
it('starts with organization and connection codes rather than linking by email',async()=>{
 render(<Page/>);expect(screen.getByText(/SAML is unavailable/)).toBeVisible();expect(screen.getByRole('button',{name:'Continue organization sign-in'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Organization code'),{target:{value:'org-one'}});fireEvent.change(screen.getByLabelText('Connection code'),{target:{value:'connection-one'}});fireEvent.click(screen.getByRole('button',{name:'Continue organization sign-in'}));await waitFor(()=>expect(start).toHaveBeenCalledWith('org-one','connection-one'));expect(await screen.findByRole('alert')).not.toHaveTextContent('Private issuer');
});

it('keeps local sign-in available when the enterprise service is unavailable',()=>{render(<Page/>);expect(screen.getByRole('link',{name:'Use local sign-in'})).toHaveAttribute('href','/login');});
it('allows a fresh attempt after a safe unavailable response',async()=>{render(<Page/>);fireEvent.change(screen.getByLabelText('Organization code'),{target:{value:'org'}});fireEvent.change(screen.getByLabelText('Connection code'),{target:{value:'connection'}});fireEvent.click(screen.getByRole('button',{name:'Continue organization sign-in'}));await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Continue organization sign-in'})).toBeEnabled();});
