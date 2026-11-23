/** Which staff tools each role can open. The engine enforces the same rules; this only hides tabs. */
export const AREAS = [
  { href: '/app/admin', label: 'Review queue', roles: ['admin', 'moderator'] },
  { href: '/app/admin/support', label: 'Support', roles: ['admin', 'support', 'moderator', 'finance', 'dpo'] },
  { href: '/app/admin/data-requests', label: 'Data requests', roles: ['admin', 'dpo'] },
  { href: '/app/admin/payouts', label: 'Payouts', roles: ['admin', 'finance'] },
  { href: '/app/admin/sources', label: 'Job sources', roles: ['admin', 'moderator'] },
  { href: '/app/admin/ai-budget', label: 'AI budget', roles: ['admin'] },
] as const;

export const can = (role: string | null | undefined, href: (typeof AREAS)[number]['href']) => !!role && (AREAS.find((a) => a.href === href)?.roles as readonly string[]).includes(role);
