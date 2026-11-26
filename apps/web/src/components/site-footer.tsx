import Link from 'next/link';
import s from './site-footer.module.css';

const COLUMNS: { title: string; links: [string, string][] }[] = [
  { title: 'Job seekers', links: [['How it works', '/#join'], ['Find a community', '/communities'], ['Browse jobs', '/jobs']] },
  { title: 'Communities', links: [['Run a community', '/owners/apply'], ['Owner rules', '/terms#owners'], ['Payouts', '/help?q=payouts']] },
  { title: 'Employers', links: [['Hire on i-jobs', '/employers'], ['Post a job', '/app/employer'], ['Employer rules', '/terms#employers']] },
  { title: 'i-jobs', links: [['About', '/about'], ['Help centre', '/help'], ['Report a job', '/help?q=report'], ['Privacy and your data', '/privacy']] },
];

/** A few links for pages where people are doing something (jobs, sign-in, forms, help). */
const SLIM: [string, string][] = [['Jobs', '/jobs'], ['Communities', '/communities'], ['Help', '/help'], ['Privacy', '/privacy'], ['Terms', '/terms']];

/** The home page gets the full site map; every other page gets the slim footer. */
export function SiteFooter({ full = false }: { full?: boolean }) {
  if (!full) {
    return (
      <footer className={s.footer}>
        <div className={`wrap ${s.slim}`}>
          <Link href="/" className={s.slogo} aria-label="i-jobs home"><img src="/logo-footer.png" alt="i-jobs by 99" width={530} height={200} /></Link>
          <nav aria-label="Footer" className={s.slinks}>{SLIM.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav>
          <span className={s.copy}>© {new Date().getFullYear()} i-jobs by 99</span>
        </div>
      </footer>
    );
  }
  return (
    <footer className={s.footer}>
      <div className={`wrap ${s.foot}`}>
        <div className={s.flogo}>
          <img src="/logo-footer.png" alt="i-jobs by 99" width={530} height={200} />
          <p className={s.blurb}>Remote jobs you can actually get, applied for while you get on with your day.</p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <h6>{c.title}</h6>
            <ul>{c.links.map(([label, href]) => <li key={label}><Link href={href}>{label}</Link></li>)}</ul>
          </div>
        ))}
      </div>
      <div className={`wrap ${s.legal}`}>
        <span>© {new Date().getFullYear()} i-jobs by 99</span>
        <div><span>English</span><span>₦ NGN</span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
      </div>
    </footer>
  );
}
