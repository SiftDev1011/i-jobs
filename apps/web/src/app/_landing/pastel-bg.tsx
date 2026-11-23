'use client';

import { useEffect } from 'react';

/** The page background turns pale green while a [data-bg="pastel"] section is in view. */
export function PastelBg() {
  useEffect(() => {
    const seen = new Map<Element, number>();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target, e.intersectionRatio));
      const on = [...seen.values()].some((r) => r > 0.25);
      document.documentElement.style.setProperty('--page-bg', on ? 'var(--pastel)' : 'var(--white)');
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    document.querySelectorAll('[data-bg="pastel"]').forEach((el) => io.observe(el));
    return () => { io.disconnect(); document.documentElement.style.removeProperty('--page-bg'); };
  }, []);
  return null;
}
