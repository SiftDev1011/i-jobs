import type { Metadata } from 'next';
import Link from 'next/link';
import { engine } from '@/lib/engine';
import { timeAgo } from '@/lib/format';
import u from '../_ui/ui.module.css';
import { AskBox, ContactForm } from './help-parts';

export const metadata: Metadata = { title: 'Help' };
const STATUS: Record<string, string> = { open: 'Open', bot_answered: 'Answered', waiting_human: 'With our team', resolved: 'Resolved' };

export default async function Help() {
  const api = await engine();
  const tickets = (await api.GET('/support/tickets')).data ?? [];
  return (
    <main className={u.page}>
      <div>
        <h1 className={u.h1}>Help</h1>
        <p className={u.lead}>Ask anything. We answer from our help articles first; questions about money, scams or your data go straight to a person.</p>
      </div>
      <AskBox />
      {tickets.length > 0 && (
        <section className={u.section}>
          <h2 className={u.h2}>Your conversations with us</h2>
          <ul className={u.list}>
            {tickets.map((t) => (
              <li key={t.id}><Link className={`${u.card} ${u.row} ${u.between}`} href={`/app/help/tickets/${t.id}`}><span><b>{t.subject}</b><br /><span className={u.muted}>{timeAgo(t.created_at)}</span></span><span className={`${u.chip} ${t.status === 'resolved' ? 't-green' : 't-ink'}`}>{STATUS[t.status ?? ''] ?? t.status}</span></Link></li>
            ))}
          </ul>
        </section>
      )}
      <section className={u.section}>
        <h2 className={u.h2}>Contact a person</h2>
        <ContactForm />
      </section>
    </main>
  );
}
