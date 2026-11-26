'use client';

import { useEffect, useRef, useState } from 'react';
import { companyTile } from '@/lib/format';
import s from './company-logo.module.css';

/**
 * The company's logo when the job source gave one; otherwise (or if it fails to load) a tile with the
 * company's initials in one of the logo colours, the same colour for the same company every time.
 */
export function CompanyLogo({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // An image that failed before the page became interactive never fires onError here.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  const box = { width: size, height: size };
  if (url && !failed) {
    return (
      <span className={s.logo} style={box}>
        <img ref={img} src={url} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    );
  }
  const tile = companyTile(name);
  return <span className={`${s.tile} ${tile.colour}`} style={{ ...box, fontSize: Math.round(size * 0.36) }} aria-hidden="true">{tile.initials}</span>;
}
