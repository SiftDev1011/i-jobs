'use server';

import { redirect } from 'next/navigation';
import { engine } from '@/lib/engine';

/** Plays Paga's part for a demo payment, then shows the same page a real payment returns to. */
export async function completeDemoPayment(id: string) {
  await (await engine()).POST('/dev/demo-payments/{paymentId}/complete', { params: { path: { paymentId: id } } }).catch(() => null);
  redirect(`/payments/${id}`);
}
