'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import s from './landing.module.css';

const STAGES: [string, number][] = [['1', 2200], ['2', 2900], ['3', 4600]];

/** A messy group-chat job post becomes a clean listing: paste, clean up, live. Loops while on screen. */
export function PasteDemo() {
  const root = useRef<HTMLElement>(null);
  const [stage, setStage] = useState('1');

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setStage('3'); return; }
    let i = 0, timer: ReturnType<typeof setTimeout> | null = null;
    const step = () => { setStage(STAGES[i][0]); timer = setTimeout(() => { i = (i + 1) % STAGES.length; step(); }, STAGES[i][1]); };
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !timer) { i = 0; step(); }
      else if (!e.isIntersecting && timer) { clearTimeout(timer); timer = null; }
    }, { threshold: 0.35 });
    io.observe(root.current!);
    return () => { io.disconnect(); if (timer) clearTimeout(timer); };
  }, []);

  const hl = (i: number, text: string) => <span className={s.hl} style={{ ['--i' as string]: i }}>{text}</span>;
  const row = (r: number) => ({ ['--r' as string]: r });

  return (
    <figure className={s.paste} ref={root} data-stage={stage} aria-label="Example: a messy job post from a group chat becomes a clean i-jobs listing">
      <ol className={s['ps-steps']} aria-hidden="true">
        <li data-s="1"><span>1</span><em>Paste<b className={s.lg}> the post</b></em></li>
        <li data-s="2"><span>2</span><em><b className={s.lg}>We </b>clean<b className={s.lg}> it</b> up</em></li>
        <li data-s="3"><span>3</span><em>Live<b className={s.lg}> for members</b></em></li>
      </ol>
      <div className={s['ps-stage']}>
        <div className={s.chat}>
          <div className={s['chat-top']}>
            <span className={s['g-av']}>LT</span>
            <div><b>Lagos Tech Hustlers</b><small>Tunde B., Ada, Kola and 245 others</small></div>
          </div>
          <div className={s['chat-body']}>
            <div className={s.bubble}>
              <span className={s.who}>Tunde B. · Admin</span>
              <p>
                🚨🚨 {hl(0, 'URGENT HIRING')}!!! 🚨<br />
                {hl(1, 'Remote Customer Support Rep')} needed at {hl(2, 'PAYLITE')} 🔥🔥<br />
                💰 {hl(3, '350k-450k monthly')}<br />
                ✅ Must know {hl(4, 'Zendesk + live chat')}<br />
                ✅ {hl(5, '2yrs exp')} 📍 {hl(6, 'Nigeria only')}<br />
                Send CV to {hl(7, 'hr@paylite.co')} 📩 or DM me<br />
                {hl(8, 'Deadline Fri 28th')}!! Share pls 🙏🙏
              </p>
              <span className={s.meta}>09:41</span>
            </div>
          </div>
          <i className={s.scan} aria-hidden="true" />
        </div>
        <article className={s.listing}>
          <div className={s['ls-top']}>
            <span className="tile t-green">PL</span>
            <span className="badge b-green"><Icon name="shield" />Checked for scams</span>
          </div>
          <div className={s['ls-row']} style={row(0)}><h5>Customer support representative</h5><p className={s.co}>Paylite · shared by Lagos Tech Hustlers</p></div>
          <div className={`${s['ls-row']} ${s.tags}`} style={row(1)}><span className="tag">Remote · Nigeria</span><span className="tag">Full time</span><span className="tag">2+ years</span></div>
          <div className={`${s['ls-row']} ${s.tags}`} style={row(2)}><span className={`tag ${s.sk}`}>Zendesk</span><span className={`tag ${s.sk}`}>Live chat</span></div>
          <div className={`${s['ls-row']} ${s['ls-pay']}`} style={row(3)}><p className={s.pay}>₦350k–₦450k <small>a month</small></p><span className="badge b-red"><Icon name="cal" />Closes Fri 28 Nov</span></div>
          <div className={`${s['ls-row']} ${s['ls-foot']}`} style={row(4)}><span className={s['fake-btn']}>Apply with i-jobs</span><span className={s.matched}><b>14</b> members matched</span></div>
        </article>
      </div>
      <figcaption>Example post</figcaption>
    </figure>
  );
}
