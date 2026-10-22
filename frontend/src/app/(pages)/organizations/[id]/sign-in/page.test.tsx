import {render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({getOrg:vi.fn(),listOrganizationSignIn:vi.fn(),createOrganizationSignIn:vi.fn(),deleteOrganizationSignIn:vi.fn(),linkOrganizationSignIn:vi.fn()}));
vi.mock('@/app/lib/legalAssistantApi',()=>api);vi.mock('next/navigation',()=>({useParams:()=>({id:'org-one'})}));
import Page from './page';
it('keeps administrative connection controls off for an ordinary member',async()=>{api.getOrg.mockResolvedValue({role:'member'});render(<Page/>);await waitFor(()=>expect(api.getOrg).toHaveBeenCalledWith('org-one'));expect(api.listOrganizationSignIn).not.toHaveBeenCalled();expect(screen.queryByLabelText('Issuer address')).toBeNull();expect(screen.getByRole('button',{name:'Link my organization identity'})).toBeDisabled();});
