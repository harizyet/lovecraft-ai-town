// Small, consistent glyph per profession, used both in the GUI panels
// (next to an agent's name) and on the map canvas (near their sprite).
// Prophet/Knight/Inquisitor reuse the same symbols already used as their
// role markers elsewhere in the UI, so the two icon systems stay consistent.
const JOB_ICONS: Record<string, string> = {
  Blacksmith: '🔨',
  Carpenter: '🪚',
  Merchant: '💰',
  'Town Guard': '⚔️',
  Healer: '⚕️',
  Steward: '📜',
  Innkeeper: '🍺',
  Farmer: '🌾',
  Priest: '✝️',
  Prophet: '✦',
  Knight: '🛡',
  Inquisitor: '⚖',
}

const DEFAULT_JOB_ICON = '👤'

export function getJobIcon(job: string | undefined): string {
  if (!job) return DEFAULT_JOB_ICON
  return JOB_ICONS[job] ?? DEFAULT_JOB_ICON
}
