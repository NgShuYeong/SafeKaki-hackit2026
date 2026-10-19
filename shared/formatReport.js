// Turns report fields into plain text. Used by server, web app and bot so the
// preview the user sees is exactly what gets copied.
export const REPORT_FIELDS = [
  { key: 'category', label: 'Suspected scam type' },
  { key: 'originalMessage', label: 'Original message', multiline: true },
  { key: 'sender', label: 'Sender (name, number, email or account)' },
  { key: 'urls', label: 'Suspicious links' },
  { key: 'incidentTime', label: 'Date and time' },
  { key: 'description', label: 'What happened', multiline: true },
  { key: 'clickedLink', label: 'Did you click a link?' },
  { key: 'sharedInfo', label: 'Information you shared' },
  { key: 'moneyLost', label: 'Did you transfer money?' },
  { key: 'amountLost', label: 'Amount lost' },
  { key: 'otherEvidence', label: 'Other evidence you have' },
];

export const MISSING = 'NOT PROVIDED';

export function fieldValue(f) {
  const v = (f?.value ?? '').toString().trim();
  return v ? v : MISSING;
}

export function formatReportText(fields, { createdAt } = {}) {
  const lines = ['SCAM REPORT (draft prepared with SafeKaki, not yet submitted to any authority)'];
  if (createdAt) lines.push(`Prepared: ${createdAt}`);
  lines.push('');
  for (const def of REPORT_FIELDS) {
    const f = fields.find((x) => x.key === def.key);
    const tag = f && f.status === 'unconfirmed' && f.value ? ' [unconfirmed]' : '';
    if (def.multiline) {
      lines.push(`${def.label}${tag}:`, fieldValue(f), '');
    } else {
      lines.push(`${def.label}${tag}: ${fieldValue(f)}`);
    }
  }
  return lines.join('\n').trim();
}
