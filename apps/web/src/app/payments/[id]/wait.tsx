'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Paga's webhook confirms the payment; until it lands, check again every few seconds for a minute. */
export function WaitForPayment() {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 60_000) { clearInterval(t); setGaveUp(true); return; }
      router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [router]);
  return gaveUp ? <p>This is taking longer than usual. If money left your account, it will show here within an hour; you don’t need to pay again.</p> : <p role="status">Waiting for Paga to confirm… this page updates by itself.</p>;
}
