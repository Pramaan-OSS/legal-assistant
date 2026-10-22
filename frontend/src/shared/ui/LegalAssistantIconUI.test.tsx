import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LegalAssistantIcon } from './LegalAssistantIconUI';
it('renders the own vector mark without a remote asset', () => { const {container} = render(<LegalAssistantIcon size={36}/>); expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 36 36'); expect(container.querySelector('svg')).toHaveAttribute('width', '36'); expect(container.querySelector('img')).toBeNull(); });
