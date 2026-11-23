'use client';

import { useActionState, useState } from 'react';
import { applyOwner } from '@/app/actions/owner';
import type { Result } from '@/lib/act';
import u from '@/app/app/_ui/ui.module.css';
import p from '../../_public/public.module.css';

/** Nigerian banks by CBN/NIP code. Check these against Paga's bank list before payouts go live. */
const BANKS: [string, string][] = [
  ['044', 'Access Bank'], ['050', 'Ecobank'], ['070', 'Fidelity Bank'], ['011', 'First Bank'], ['214', 'FCMB'], ['058', 'GTBank'],
  ['082', 'Keystone Bank'], ['50211', 'Kuda'], ['50515', 'Moniepoint'], ['999992', 'OPay'], ['999991', 'PalmPay'], ['076', 'Polaris Bank'],
  ['101', 'Providus Bank'], ['221', 'Stanbic IBTC'], ['232', 'Sterling Bank'], ['033', 'UBA'], ['032', 'Union Bank'], ['215', 'Unity Bank'],
  ['035', 'Wema Bank'], ['057', 'Zenith Bank'],
];

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function ApplyForm({ minNaira, share, appUrl, freeWeeks }: { minNaira: number; share: number; appUrl: string; freeWeeks: boolean }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(applyOwner, null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const shownSlug = slugTouched ? slug : slugify(name);
  const err = (f: string) => (r && !r.ok && r.field === f ? <span className="err">{r.error}</span> : null);
  const host = appUrl.replace(/^https?:\/\//, '');

  return (
    <form action={act} className={p.panel} noValidate={false}>
      <fieldset className={p.fieldset}>
        <legend>About you</legend>
        <p className={u.help}>We check every owner once. We keep a fingerprint of your ID number to stop repeat accounts, not the number itself, and never show it to anyone.</p>
        <div className={u.field}><label htmlFor="legal_name">Your full legal name</label><input className="input" id="legal_name" name="legal_name" required minLength={3} maxLength={120} autoComplete="name" />{err('legal_name')}</div>
        <div className={u.grid2}>
          <div className={u.field}>
            <label htmlFor="id_type">ID type</label>
            <select className="input" id="id_type" name="id_type" required defaultValue="">
              <option value="" disabled>Choose one</option>
              <option value="nin">NIN</option><option value="passport">International passport</option><option value="drivers_licence">Driver’s licence</option><option value="voters_card">Voter’s card</option>
            </select>{err('id_type')}
          </div>
          <div className={u.field}><label htmlFor="id_number">ID number</label><input className="input" id="id_number" name="id_number" required minLength={5} maxLength={40} autoComplete="off" />{err('id_number')}</div>
        </div>
      </fieldset>

      <fieldset className={p.fieldset}>
        <legend>Where we pay you</legend>
        <p className={u.help}>Optional now, needed before your first payout. The account should be in your name.</p>
        <div className={u.grid2}>
          <div className={u.field}>
            <label htmlFor="bank_code">Bank</label>
            <select className="input" id="bank_code" name="bank_code" defaultValue=""><option value="">Choose your bank</option>{BANKS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>{err('bank_code')}
          </div>
          <div className={u.field}><label htmlFor="bank_account_number">Account number</label><input className="input" id="bank_account_number" name="bank_account_number" inputMode="numeric" pattern="\d{10}" maxLength={10} autoComplete="off" placeholder="10 digits" />{err('bank_account_number')}</div>
        </div>
      </fieldset>

      <fieldset className={p.fieldset}>
        <legend>Your group</legend>
        <div className={u.field}><label htmlFor="community_name">Community name</label><input className="input" id="community_name" name="community_name" required minLength={3} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lagos Tech Hustlers" />{err('community_name')}</div>
        <div className={u.field}>
          <label htmlFor="slug">Your link</label>
          <input className="input" id="slug" name="slug" required pattern="[a-z0-9-]{3,40}" value={shownSlug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
          <span className={u.help}>{host}/join/<b>{shownSlug || 'your-link'}</b></span>{err('slug')}
        </div>
        <div className={u.field}><label htmlFor="description">What it’s about</label><textarea className="input" id="description" name="description" rows={3} maxLength={1000} placeholder="Remote tech jobs for people in Lagos, shared every weekday." /></div>
        <div className={u.field}>
          <label htmlFor="proof_links">Links to your WhatsApp or Telegram group</label>
          <textarea className="input" id="proof_links" name="proof_links" rows={2} required placeholder={'https://chat.whatsapp.com/…\nhttps://t.me/…'} />
          <span className={u.help}>One per line. We use them to check the group is real and active.</span>{err('proof_links')}
        </div>
        <div className={u.grid2}>
          <div className={u.field}><label htmlFor="claimed_member_count">About how many members?</label><input className="input" id="claimed_member_count" name="claimed_member_count" inputMode="numeric" maxLength={9} /></div>
          <div className={u.field}><label htmlFor="group_started_on">When did it start?</label><input className="input" id="group_started_on" name="group_started_on" type="date" max={new Date().toISOString().slice(0, 10)} /></div>
        </div>
      </fieldset>

      <fieldset className={p.fieldset}>
        <legend>What members pay</legend>
        <div className={u.row} style={{ alignItems: 'flex-end' }}>
          <div className={u.field}><label htmlFor="price">Price (₦)</label><input className="input" id="price" name="price" inputMode="numeric" required placeholder={minNaira.toLocaleString('en-NG')} style={{ width: 160 }} /></div>
          <div className={u.field}>
            <label htmlFor="billing_period">Charged</label>
            <select className="input" id="billing_period" name="billing_period" defaultValue="monthly" style={{ width: 180 }}>
              <option value="monthly">Every month</option><option value="quarterly">Every 3 months</option><option value="yearly">Every year</option>
            </select>
          </div>
        </div>
        <span className={u.help}>At least ₦{minNaira.toLocaleString('en-NG')}. You keep {100 - share}% of every payment; i-jobs keeps {share}% to run the matching and applying.</span>{err('price')}
        {freeWeeks && <label className={u.toggle}><input type="checkbox" name="trial_enabled" /><span><b>Offer a free week</b><span>New members confirm their phone number and try i-jobs for 7 days.</span></span></label>}
        <label className={u.toggle}><input type="checkbox" name="approval_required" /><span><b>I approve who joins</b><span>People who find you through search wait for you to let them in. Your invite link and code always work.</span></span></label>
      </fieldset>

      <label className={u.toggle}>
        <input type="checkbox" name="agree" required />
        <span><b>I agree to the community owner rules</b><span>I’ll only share real jobs, never charge members to apply, and accept strikes for scam posts. <a href="/terms#owners" target="_blank" style={{ textDecoration: 'underline' }}>Read the rules</a></span></span>
      </label>
      {r && !r.ok && !['legal_name', 'id_type', 'id_number', 'bank_code', 'bank_account_number', 'community_name', 'slug', 'proof_links', 'price'].includes(r.field ?? '') && <p className="err" role="alert">{r.error}</p>}
      <div><button className="btn btn-green" disabled={pending}>{pending ? 'Sending…' : 'Send for review'}</button></div>
    </form>
  );
}
