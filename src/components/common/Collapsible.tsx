/**
 * Details that are not needed at first glance: closed by default, one click (or Enter) opens them.
 * Native <details>, so it works with the keyboard and screen readers without extra code.
 *   variant "card":   a whole page section (rounded card with a heading)
 *   variant "inline": a smaller block inside a card
 */
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';

interface Props {
  summary: ReactNode;
  children: ReactNode;
  variant?: 'card' | 'inline';
  defaultOpen?: boolean;
  className?: string;
}

export function Collapsible({ summary, children, variant = 'inline', defaultOpen = false, className }: Props) {
  const card = variant === 'card';
  return (
    <details open={defaultOpen} className={cn('group', card ? 'rounded-2xl border border-line bg-surface' : 'rounded-xl border border-line', className)}>
      <summary
        className={cn(
          'flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl text-ink hover:bg-raised/60 [&::-webkit-details-marker]:hidden',
          card ? 'px-4 py-2 text-base font-semibold' : 'px-3 text-sm font-medium',
        )}
      >
        <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        <span className="min-w-0 flex-1">{summary}</span>
      </summary>
      <div className={card ? 'px-4 pb-4' : 'px-3 pb-3'}>{children}</div>
    </details>
  );
}
