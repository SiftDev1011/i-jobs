'use client';

/** Opens the Onboard sheet (on any page that renders <OnboardSheet />). */
export function openOnboard(tab: 'code' | 'find' = 'code') {
  window.dispatchEvent(new CustomEvent('ij:onboard', { detail: tab }));
}

export function OnboardButton({ tab = 'code', className = 'btn btn-green', children }: { tab?: 'code' | 'find'; className?: string; children: React.ReactNode }) {
  return <button type="button" className={className} onClick={() => openOnboard(tab)}>{children}</button>;
}
