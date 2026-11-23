'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import s from './landing.module.css';

const WORDS = [
  { t: 'scope', bg: 'var(--tag-blue-bg)', fg: 'var(--tag-blue)' },
  { t: 'find', bg: 'var(--tag-green-bg)', fg: 'var(--tag-green)' },
  { t: 'match', bg: 'var(--tag-purple-bg)', fg: 'var(--tag-purple)' },
  { t: 'recommend', bg: 'var(--tag-yellow-bg)', fg: 'var(--tag-yellow)' },
  { t: 'track', bg: 'var(--tag-red-bg)', fg: 'var(--tag-red)' },
  { t: 'apply for', bg: 'var(--tag-gray-bg)', fg: 'var(--tag-gray)' },
];
const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** "We [scope] jobs for you": the word rolls down into a coloured pill that resizes to fit. */
export function RollingWord() {
  const [cur, setCur] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const measure = useRef<HTMLSpanElement>(null);

  useIso(() => {
    const size = () => measure.current && setWidth(measure.current.offsetWidth);
    size();
    document.fonts?.ready.then(size);
    window.addEventListener('resize', size);
    return () => window.removeEventListener('resize', size);
  }, [cur]);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setCur((c) => { setPrev(c); return (c + 1) % WORDS.length; }), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <span className={s.pill} style={{ width: width ?? undefined, backgroundColor: WORDS[cur].bg }} aria-hidden="true">
        <span className={s.measure} ref={measure}>{WORDS[cur].t}</span>
        {WORDS.map((w, i) => (
          <span key={w.t} className={`${s.w} ${i === cur ? s.in : i === prev ? s.out : ''}`} style={{ color: w.fg }}>{w.t}</span>
        ))}
      </span>
      <span className="sr-only">{WORDS[0].t}</span>
    </>
  );
}
