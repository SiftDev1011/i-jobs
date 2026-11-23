'use client';

import { useEffect, useState } from 'react';
import s from './landing.module.css';

const WORDS = ['job title', 'role', 'side gig', 'hustle', 'grad opportunity'];

/** "Want a new [typed word]?" */
export function Typewriter() {
  const [text, setText] = useState(WORDS[0]);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let wi = 0, ci = WORDS[0].length, del = true, t: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (del) {
        ci--; setText(WORDS[wi].slice(0, ci));
        if (ci === 0) { del = false; wi = (wi + 1) % WORDS.length; }
        t = setTimeout(tick, 45);
      } else {
        const w = WORDS[wi]; ci++; setText(w.slice(0, ci));
        if (ci === w.length) { del = true; t = setTimeout(tick, 1700); } else t = setTimeout(tick, 85);
      }
    };
    t = setTimeout(tick, 1800);
    return () => clearTimeout(t);
  }, []);
  return (
    <span className={s.type}>
      <span>{text}</span><span className={s.caret} aria-hidden="true" />
    </span>
  );
}
