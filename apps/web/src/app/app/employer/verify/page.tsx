import Link from 'next/link';
import u from '../../_ui/ui.module.css';
import { VerifyFlow } from '../_parts/verify-flow';

export const metadata = { title: 'Add a company' };

/** Adding another company, for people who already have one (the index page redirects them to it). */
export default function AddCompany() {
  return (
    <main className={u.page}>
      <div>
        <p className={u.crumb}><Link href="/app/employer">Hiring</Link></p>
        <h1 className={u.h1}>Add a company</h1>
        <p className={u.lead}>Confirm a work email at the company’s domain. Free email providers can’t be used.</p>
      </div>
      <div className={u.card}><VerifyFlow /></div>
    </main>
  );
}
