import { describe, expect, it } from 'vitest';
import { connectedAppAccessNotice } from './connectedAppAccess';
describe('account access notices', () => {
 it('discloses full mail access and profile/contacts separately from app usage', () => {
  expect(connectedAppAccessNotice('gmail')).toMatch(/permanently delete mail, and read your profile and contacts/);
  expect(connectedAppAccessNotice('gmail')).toMatch(/requires your approval/);
 });
 it('discloses every-file access and keeps Drive aliases consistent', () => {
  expect(connectedAppAccessNotice('google_drive')).toBe(connectedAppAccessNotice('googledrive'));
  expect(connectedAppAccessNotice('googledrive')).toContain('every file');
 });
 it('discloses known grants and the page picker', () => {
  for (const slug of ['google_calendar', 'slack', 'hubspot']) expect(connectedAppAccessNotice(slug)).toContain('read and write');
  expect(connectedAppAccessNotice('notion')).toContain('own picker');
 });
 it('does not claim narrower grants for unknown apps', () => {
  for (const slug of ['google_sheets', 'google_docs', 'google_search_console', 'google_analytics', 'airtable', 'linear', 'salesforce', 'calendly', 'outlook', 'github', 'unrecognised']) {
   expect(connectedAppAccessNotice(slug)).toContain('may give this app full access');
   expect(connectedAppAccessNotice(slug)).toContain('actions you enable');
  }
 });
});
