import type { Metadata } from 'next';
import { engine, must } from '@/lib/engine';
import { Gate, gated } from '../_ui/gate';
import u from '../_ui/ui.module.css';
import { AutopilotForm } from './autopilot-form';

export const metadata: Metadata = { title: 'Autopilot' };

export default async function AutopilotPage() {
  const api = await engine();
  const r = await gated(async () => {
    const [rules, consents] = await Promise.all([api.GET('/me/autopilot').then(must), api.GET('/me/consents').then(must)]);
    return { rules, consents };
  });
  return (
    <main className={u.page}>
      <div>
        <h1 className={u.h1}>Autopilot</h1>
        <p className={u.lead}>Autopilot sends applications for jobs that fit your rules, from your own i-jobs email address. You can cancel any of them before they go.</p>
      </div>
      {r.gate ? <Gate error={r.gate} /> : <AutopilotForm rules={r.data.rules} consented={!!r.data.consents.find((c) => c.purpose === 'autopilot')?.granted} />}
    </main>
  );
}
