export function sageStatusMeta(status: string): { label: string; fg: string; bg: string } {
  switch (status) {
    case 'PENDING':
      return { label: 'In progress', fg: '#B45309', bg: '#FEF3C7' };
    case 'APPROVED':
      return { label: 'Done', fg: '#047857', bg: '#D1FAE5' };
    case 'PUBLISHED':
      return { label: 'Published', fg: '#0369A1', bg: '#E0F2FE' };
    case 'DISMISSED':
      return { label: 'Dismissed', fg: '#475569', bg: '#F1F5F9' };
    case 'FAILED':
      return { label: "Couldn't complete", fg: '#B91C1C', bg: '#FEE2E2' };
    default:
      return { label: status, fg: '#475569', bg: '#F1F5F9' };
  }
}
