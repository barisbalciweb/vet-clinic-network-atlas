/** Details panel: on the right on desktop, a bottom sheet on phones. */
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

interface Props {
  label: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}

export function SidePanel({ label, closeLabel, onClose, children }: Props) {
  return (
    <aside
      aria-label={label}
      className={cn(
        'absolute z-30 flex flex-col overflow-hidden border-line bg-surface shadow-2xl',
        // phone: bottom sheet
        'inset-x-0 bottom-0 max-h-[70%] rounded-t-2xl border-t',
        // desktop: right panel
        'md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[380px] md:rounded-none md:border-l md:border-t-0',
      )}
    >
      <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line md:hidden" aria-hidden="true" />
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-raised hover:text-ink"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
      <div className="overflow-y-auto overscroll-contain p-4 pt-3 md:pt-4">{children}</div>
    </aside>
  );
}

/** Section heading inside the panel */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}
