'use client';

import { useEffect, useRef, useState } from 'react';
import s from './landing.module.css';

const ROLES = [
  'Customer support · Remote', 'Data analyst', 'Product designer', 'Virtual assistant', 'Frontend developer',
  'Bookkeeper · Part time', 'Content writer', 'Backend engineer · Node.js', 'Social media manager', 'Sales development rep',
  'Project manager', 'QA tester', 'UX researcher', 'Video editor', 'Graphic designer', 'Copywriter', 'HR assistant',
  'Technical recruiter', 'Community manager', 'Data entry clerk', 'Mobile developer · Flutter', 'DevOps engineer',
  'Accountant · ACCA', 'French translator', 'Online tutor', 'Operations associate', 'Marketing associate', 'SEO specialist',
  'Executive assistant', 'Product manager', 'Technical writer', 'Customer success', 'Graduate trainee', 'Software intern',
  'Email marketer', 'Business analyst', 'Shopify developer', 'Chat support · Night shift', 'Paralegal', 'Grant writer · NGO',
  'Data scientist', 'Motion designer', 'Payroll officer', 'IT support', 'Cloud engineer · AWS', 'Brand designer',
  'Podcast editor', 'Research assistant', 'Account manager', 'Python developer',
];

interface Cell { role: string; key: number; leaving?: { role: string; key: number } }

/**
 * The faint table along the bottom of the hero: 5 x 3 on desktop, 3 x 3 on phones.
 * About once a second one cell swaps its job title for one not on screen.
 */
export function FloorTable({ searchId }: { searchId: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ cols: number; top: number; rh: number; small: boolean } | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const el = root.current!;
    const hero = el.parentElement!;
    let lastW = 0;
    const build = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H || W === lastW) return;
      lastW = W;
      const small = W < 768, cols = small ? 3 : 5, rows = 3;
      const search = document.getElementById(searchId);
      const top = search ? search.getBoundingClientRect().bottom - hero.getBoundingClientRect().top + (small ? 24 : 40) : H * 0.6;
      const rh = Math.max(small ? 58 : 72, Math.round((H - top) / (rows - 0.4)));
      const label = (r: string) => (small ? r.split(' · ')[0] : r);
      const pool = ROLES.map(label).filter((r) => !small || r.length <= 16).sort(() => Math.random() - 0.5);
      setLayout({ cols, top, rh, small });
      setCells(pool.slice(0, cols * rows).map((role) => ({ role, key: seq.current++ })));
    };
    build();
    document.fonts?.ready.then(build);
    const ro = new ResizeObserver(build);
    ro.observe(el);
    return () => ro.disconnect();
  }, [searchId]);

  useEffect(() => {
    if (!layout || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const swap = () => setCells((cur) => {
      const on = new Set(cur.map((c) => c.role));
      const free = ROLES.map((r) => (layout.small ? r.split(' · ')[0] : r)).filter((r) => !on.has(r) && (!layout.small || r.length <= 16));
      if (!free.length || !cur.length) return cur;
      const i = Math.floor(Math.random() * cur.length);
      const next = free[Math.floor(Math.random() * free.length)];
      return cur.map((c, j) => (j === i ? { role: next, key: seq.current++, leaving: { role: c.role, key: c.key } } : c));
    });
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !timer) timer = setInterval(swap, 1100);
      else if (!e.isIntersecting && timer) { clearInterval(timer); timer = null; }
    });
    io.observe(root.current!);
    return () => { io.disconnect(); if (timer) clearInterval(timer); };
  }, [layout]);

  return (
    <div className={s.floor} ref={root} aria-hidden="true">
      {layout && (
        <div className={s.tbl} style={{ top: layout.top, ['--cols' as string]: layout.cols, ['--rh' as string]: `${layout.rh}px` }}>
          {cells.map((c, i) => (
            <div key={i} className={`${s.cell} ${i % layout.cols === layout.cols - 1 ? s.last : ''}`}>
              {c.leaving && <FadeOut key={c.leaving.key} text={c.leaving.role} />}
              <FadeIn key={c.key} text={c.role} animate={!!c.leaving} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FadeIn({ text, animate }: { text: string; animate: boolean }) {
  const [entered, setEntered] = useState(!animate);
  useEffect(() => {
    if (entered) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    return () => cancelAnimationFrame(r);
  }, [entered]);
  return <span className={`${s['job-t']} ${entered ? '' : s.enter}`}>{text}</span>;
}

function FadeOut({ text }: { text: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setGone(true)));
    return () => cancelAnimationFrame(r);
  }, []);
  return <span className={`${s['job-t']} ${gone ? s.leave : ''}`}>{text}</span>;
}
