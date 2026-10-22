/** Account consent is broader than the actions enabled inside this app. */
export const connectedAppChoices = [
 ['files', 'Files', 'googledrive'], ['mail', 'Mail', 'gmail'],
 ['calendar', 'Calendar', 'googlecalendar'], ['chat', 'Team chat', 'slack'],
 ['notes', 'Notes', 'notion'], ['tables', 'Tables', 'airtable'], ['work', 'Work tracking', 'linear'],
] as const;
const usage = ' This app uses only the actions you enable. Create, change, send and delete actions require your approval.';
const notices: Record<string, string> = {
 gmail: 'Connecting gives this app full access to your Gmail: it can read, send and permanently delete mail, and read your profile and contacts. This app can fetch mail and labels through enabled actions; sending, changing or deleting mail requires your approval.',
 googledrive: 'Connecting gives this app full access to your Google Drive: it can read, change, share and delete every file.' + usage,
 google_calendar: 'Connecting gives this app read and write access to your Google Calendar.' + usage,
 slack: 'Connecting gives this app read and write access to your Slack account.' + usage,
 hubspot: 'Connecting gives this app read and write access to your HubSpot account.' + usage,
 notion: 'Connecting gives this app access to the Notion pages you choose in Notion’s own picker.' + usage,
};
const uncertain: Record<string, string> = {
 googlesheets: 'Google Sheets', google_sheets: 'Google Sheets', googledocs: 'Google Docs', google_docs: 'Google Docs',
 google_search_console: 'Google Search Console', google_analytics: 'Google Analytics', airtable: 'Airtable', linear: 'Linear',
 salesforce: 'Salesforce', calendly: 'Calendly', outlook: 'Outlook', github: 'GitHub',
};
export function connectedAppAccessNotice(slug: string): string {
 const canonical = ({ google_drive: 'googledrive', googlecalendar: 'google_calendar' } as Record<string, string>)[slug] ?? slug;
 return notices[canonical] ?? `Connecting may give this app full access to your ${uncertain[canonical] ?? 'connected app'} account.${usage}`;
}
