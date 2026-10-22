import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ConnectorApprovalItem } from '@legal-assistant/contracts';
import { ConnectorActionCard } from './ConnectorActionCard';

const item: ConnectorApprovalItem = {
  id: 'approval-1', kind: 'approval', connector_name: 'Pramaan', tool_name: 'summarize_selected_document', title: 'Summarize document',
  arguments: { doc_id: 'contract.pdf' },
  binding: { type: 'outcome', outcome_id: 'document.summarize', plan: 'plan-1', prepared_at: 1, input_hash: 'a'.repeat(64), documents: [{ document_id: 'doc-1', version_id: 'version-1' }] },
  estimate: { maximum_cost_usd: '0.014030', steps: ['Parse the document', 'Summarize its text'], expires_at: '2026-10-12T12:15:00Z' },
};
describe('outcome review card', () => {
  it('shows maximum cost, ordered steps and the selected file before approval', () => {
    const { container } = render(<ConnectorActionCard item={item} />);
    expect(screen.getByText('Maximum cost: $0.014030 USD')).toBeVisible();
    expect(screen.getAllByRole('listitem').map(element => element.textContent)).toEqual(['Parse the document', 'Summarize its text']);
    expect(screen.getByText('contract.pdf')).toBeVisible();
    expect(container.textContent).not.toContain('plan-1');
    expect(container.textContent).not.toContain('version-1');
  });
});

it.each(['0.000000','0.007000'])('shows typical %s as the main approval figure', (typical_cost_usd)=>{
 render(<ConnectorActionCard item={{...item,estimate:{...item.estimate!,typical_cost_usd}}}/>);
 expect(screen.getByText(`usually about $${typical_cost_usd}`).tagName).toBe('STRONG');expect(screen.getByText('at most $0.014030').tagName).toBe('SMALL');expect(screen.queryByText(/Maximum cost/)).toBeNull();
});
