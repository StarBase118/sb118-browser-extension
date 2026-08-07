export interface LinkDef { id: string; label: string; url: string; tier: 'member' | 'staff'; icon?: string }

export const MEMBER_LINKS: LinkDef[] = [
  { id: 'hq', label: 'HQ', url: 'https://hq.starbase118.net', tier: 'member', icon: '🏛' },
  { id: 'wiki', label: 'Wiki', url: 'https://wiki.starbase118.net', tier: 'member', icon: '📖' },
  { id: 'discord', label: 'Discord', url: 'https://discord.gg/starbase118', tier: 'member', icon: '💬' },
  { id: 'site', label: 'Main site', url: 'https://www.starbase118.net', tier: 'member', icon: '🌐' },
  { id: 'sims', label: 'Sim archive', url: 'https://www.starbase118.net/sims', tier: 'member', icon: '📜' },
]

export const STAFF_LINKS: LinkDef[] = [
  { id: 'forums', label: 'Forums', url: 'https://staff.starbase118.net', tier: 'staff' },
  { id: 'authentik', label: 'Authentik', url: 'https://auth.starbase118.net', tier: 'staff' },
  { id: 'n8n', label: 'n8n', url: 'https://n8n.starbase118.net', tier: 'staff' },
  { id: 'discourse-admin', label: 'Forum admin', url: 'https://staff.starbase118.net/admin', tier: 'staff' },
]

export function visibleLinks(isStaff: boolean): LinkDef[] {
  return isStaff ? [...MEMBER_LINKS, ...STAFF_LINKS] : [...MEMBER_LINKS]
}
