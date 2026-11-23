'use client';

import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, PAY, TYPES, type Filters } from './filters';
import s from './jobs.module.css';

/**
 * The Filter button beside the search, and the panel it opens: from the right on a computer,
 * from the bottom on a phone. The panel is a plain GET form, so the address always says what's
 * filtered and the back button works.
 */
export function FilterPanel({ f, count }: { f: Filters; count: number }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    heading.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', esc); };
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  return (
    <>
      <button ref={button} type="button" className={s.filterBtn} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
        </svg>
        <span>Filter</span>
        {count > 0 && <b className={s.count} aria-label={`${count} on`}>{count}</b>}
      </button>

      {open && (
        <div className={s.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
          <form className={s.drawer} action="/jobs" role="dialog" aria-modal="true" aria-labelledby="filter-h" onSubmit={(e) => {
            // Leave "Any" choices out of the address.
            // (The panel stays mounted: removing the form mid-submit cancels it. The new page replaces it.)
            for (const el of Array.from(e.currentTarget.elements) as HTMLInputElement[]) if (el.name && el.value === '') el.disabled = true;
          }}>
            <div className={s.drawerHead}>
              <h2 id="filter-h" ref={heading} tabIndex={-1}>Filter jobs</h2>
              <button type="button" className={s.x} onClick={close} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>

            <div className={s.drawerBody}>
              {f.q && <input type="hidden" name="q" value={f.q} />}

              <fieldset className={s.group}>
                <legend>Job type</legend>
                <div className={s.opts}>
                  {TYPES.map(([k, label]) => (
                    <label key={k} className={s.opt}><input type="checkbox" name="type" value={k} defaultChecked={f.types.includes(k)} /> {label}</label>
                  ))}
                </div>
              </fieldset>

              <fieldset className={s.group}>
                <legend>Job function</legend>
                <div className={s.opts}>
                  <label className={s.opt}><input type="radio" name="category" value="" defaultChecked={!f.category} /> Any</label>
                  {CATEGORIES.map(([k, label]) => (
                    <label key={k} className={s.opt}><input type="radio" name="category" value={k} defaultChecked={f.category === k} /> {label}</label>
                  ))}
                </div>
              </fieldset>

              <fieldset className={s.group}>
                <legend>Pays at least, a month</legend>
                <div className={s.opts}>
                  <label className={s.opt}><input type="radio" name="pay" value="" defaultChecked={!f.pay} /> Any pay</label>
                  {PAY.map(([k, label]) => (
                    <label key={k} className={s.opt}><input type="radio" name="pay" value={k} defaultChecked={f.pay === k} /> {label}</label>
                  ))}
                </div>
                <p className={s.note}>Only jobs that show their pay in that currency.</p>
              </fieldset>

              <fieldset className={s.group}>
                <legend>Location and employer</legend>
                <label className={s.opt}><input type="checkbox" name="worldwide" value="1" defaultChecked={f.worldwide} /> Open to anyone, anywhere</label>
                <label className={s.opt}><input type="checkbox" name="verified" value="1" defaultChecked={f.verified} /> Verified employers only</label>
              </fieldset>
            </div>

            <div className={s.drawerFoot}>
              <a className="btn btn-line" href={f.q ? `/jobs?q=${encodeURIComponent(f.q)}` : '/jobs'}>Clear all</a>
              <button className="btn btn-green">Show jobs</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
