import { engine, features, must } from '@/lib/engine';
import u from '../../../_ui/ui.module.css';
import { loadCommunity } from '../../_parts/load';
import { SettingsForm } from '../../_parts/settings-form';

export default async function Settings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await loadCommunity(id);
  const [rules, f] = await Promise.all([(await engine()).GET('/owner/pricing-rules').then(must), features()]);
  return (
    <section className={u.section}>
      <div className={u.card}>
        <SettingsForm id={id} c={{
          description: c.description, priceNaira: (c.price?.amount_minor ?? 0) / 100, minNaira: rules.minimum_price.amount_minor / 100,
          period: c.billing_period ?? 'monthly', trial: !!c.trial_enabled, approval: !!c.approval_required, freeWeeks: f.free_weeks, share: c.platform_share_percent ?? rules.platform_share_percent,
        }} />
      </div>
      <p className={u.help}>To change your community’s name or link, contact support.</p>
    </section>
  );
}
