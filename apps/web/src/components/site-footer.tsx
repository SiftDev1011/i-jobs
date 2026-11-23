import Link from 'next/link';
import s from './site-footer.module.css';

const COLUMNS: { title: string; links: [string, string][] }[] = [
  { title: 'Job seekers', links: [['How it works', '/#join'], ['Find a community', '/communities'], ['Browse jobs', '/jobs']] },
  { title: 'Communities', links: [['Run a community', '/owners/apply'], ['Owner rules', '/terms#owners'], ['Payouts', '/help?q=payouts']] },
  { title: 'Employers', links: [['Hire on i-jobs', '/employers'], ['Post a job', '/app/employer'], ['Employer rules', '/terms#employers']] },
  { title: 'i-jobs', links: [['About', '/about'], ['Help centre', '/help'], ['Report a job', '/help?q=report'], ['Privacy and your data', '/privacy']] },
];

export function SiteFooter() {
  return (
    <footer className={s.footer}>
      <div className={`wrap ${s.foot}`}>
        <div className={s.flogo}>
          <img src="/logo-footer.png" alt="i-jobs by 99" width={527} height={200} />
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
