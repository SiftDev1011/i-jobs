import type { Chip } from '@/lib/labels';
import u from '../_ui/ui.module.css';

/** A status word in its colour. Unknown values show as plain grey text. */
export function StatusChip({ value, map }: { value: string | null | undefined; map: Record<string, Chip> }) {
  const [label, tone] = map[value ?? ''] ?? [value ?? '—', 'gray'];
  return <span className={`${u.chip} ${u[tone]}`}>{label}</span>;
}
