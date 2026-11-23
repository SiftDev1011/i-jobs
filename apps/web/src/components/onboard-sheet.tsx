'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { searchCommunities, type CommunityHit } from '@/app/actions/communities';
import { companyTile } from '@/lib/format';
import { Icon } from './icons';
import s from './onboard-sheet.module.css';

const CODE = /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/;

/** "Onboard": enter an invite code (goes to its join page) or find a verified community. */
export function OnboardSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'code' | 'find'>('code');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CommunityHit[] | null>(null);
  const [searching, startSearch] = useTransition();
  const last = useRef<HTMLElement | null>(null);
  const codeIn = useRef<HTMLInputElement>(null);
  const findIn = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = (e: Event) => {
      last.current = document.activeElement as HTMLElement;
      setTab(((e as CustomEvent).detail as 'code' | 'find') ?? 'code');
      setOpen(true);
    };
    window.addEventListener('ij:onboard', show);
    return () => window.removeEventListener('ij:onboard', show);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    (tab === 'code' ? codeIn : findIn).current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', esc); };
  }, [open, tab]);

  useEffect(() => {
    if (!open || tab !== 'find') return;
    const t = setTimeout(() => startSearch(async () => {
      try { setHits(await searchCommunities(q)); } catch { setHits([]); }
    }), 250);
    return () => clearTimeout(t);
  }, [q, open, tab]);

  function close() {
    setOpen(false);
    last.current?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = code.trim().toUpperCase();
    if (!v) return setErr('Enter your invite code.');
    if (!CODE.test(v)) return setErr('That doesn’t look like an invite code. Check it with your community owner.');
    router.push(`/join/${encodeURIComponent(v)}`);
  }

  if (!open) return null;
  return (
    <div className={s.sheet} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className={s.panel} role="dialog" aria-modal="true" aria-labelledby="onboard-h">
        <div className={s['panel-head']}>
          <h2 id="onboard-h">Onboard</h2>
          <button className={s.x} onClick={close} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className={s.tabs} role="tablist">
          <button role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>I have an invite code</button>
          <button role="tab" aria-selected={tab === 'find'} onClick={() => setTab('find')}>Find a community</button>
        </div>
        {tab === 'code' ? (
          <form onSubmit={submit} noValidate>
            <label htmlFor="code-in">Invite code</label>
            <input ref={codeIn} className={`input ${s['code-input']}`} id="code-in" autoComplete="off" placeholder="LTH-2048" value={code}
              onChange={(e) => { setCode(e.target.value); setErr(null); }} />
            {err && <p className="err">{err}</p>}
            <p className="hint" style={{ margin: '10px 0 16px' }}>Your community owner shares this code or a link with it.</p>
            <button className="btn btn-green btn-block" type="submit">Continue</button>
          </form>
        ) : (
          <div>
            <label htmlFor="find-in">Search communities</label>
            <input ref={findIn} className="input" id="find-in" placeholder="Lagos, design, graduates" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className={s.clist} style={{ marginTop: 14 }} aria-busy={searching}>
              {(hits ?? []).map((c) => {
                const t = companyTile(c.name);
                return (
                  <div className={s.citem} key={c.id}>
                    <span className={`tile ${t.colour}`}>{t.initials}</span>
                    <div className={s.info}><h4>{c.name}</h4><p className={s.meta}>{c.member_count} members{c.verified ? ', verified' : ''}</p></div>
                    <Link className={s.req} href={`/join/${encodeURIComponent(c.slug)}`} onClick={() => setOpen(false)}>View</Link>
                  </div>
                );
              })}
            </div>
            {hits && hits.length === 0 && !searching && <p className="hint" style={{ marginTop: 12 }}>No communities match that search. Try a city or a skill.</p>}
          </div>
        )}
        <p className={s.login}>Already a member? <Link href="/sign-in" onClick={() => setOpen(false)}>Log in</Link></p>
      </div>
    </div>
  );
}
