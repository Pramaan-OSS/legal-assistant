import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SsoAuthButton } from './SsoAuthButton';
it('explains pending organization sign-in without a dead login button', () => { render(<SsoAuthButton/>); expect(screen.getByText(/Organization sign-in is unavailable/)).toBeVisible(); expect(screen.queryByRole('button')).toBeNull(); });
