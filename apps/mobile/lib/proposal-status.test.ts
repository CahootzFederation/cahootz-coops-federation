import { plainProposalStatus, proposalStatusLabel } from './proposal-status';

describe('proposalStatusLabel', () => {
  it.each([
    ['submitted', 'Being checked'],
    ['VOTABLE', 'Open for discussion'],
    ['rejected', 'Not approved'],
    ['FUNDED', 'Funded'],
  ])('shows %s as %s', (status, label) => {
    expect(proposalStatusLabel(status)).toBe(label);
  });

  it('never shows a raw enum value', () => {
    expect(proposalStatusLabel('SOME_NEW_STATE')).toBe('Some new state');
  });
});

describe('plainProposalStatus', () => {
  it('reads well inside a sentence', () => {
    expect(plainProposalStatus('APPROVED')).toBe('approved');
    expect(plainProposalStatus('votable')).toBe('open for discussion');
  });
});
