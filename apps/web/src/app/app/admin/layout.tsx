import u from '../_ui/ui.module.css';
import { AdminTabs } from './_parts/admin-tabs';
import { staffRole } from './_parts/staff';

export const metadata = { title: 'Staff tools' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const role = await staffRole();
  return (
    <main className={`${u.page} ${u.wide}`}>
      <div className={u.head}>
        <h1 className={u.h1}>Staff tools</h1>
        <span className={`${u.chip} ${u.gray}`}>Signed in as {role}</span>
      </div>
      <AdminTabs role={role} />
      {children}
    </main>
  );
}
