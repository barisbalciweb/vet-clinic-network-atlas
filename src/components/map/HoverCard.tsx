/** Hover summary of a node: what it is, in one or two sentences. Never captures the pointer. */
import type { HoverInfo } from './MapUiContext';

const WIDTH = 280;

export function HoverCard({ info }: { info: HoverInfo | null }) {
  if (!info) return null;
  const { rect } = info;
  const below = rect.bottom + 150 < window.innerHeight;
  const left = Math.max(8, Math.min(window.innerWidth - WIDTH - 8, rect.left + rect.width / 2 - WIDTH / 2));
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-xl border border-line bg-surface p-3 shadow-lg"
      style={{ width: WIDTH, left, ...(below ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }) }}
    >
      <div className="text-sm font-semibold text-ink">{info.title}</div>
      {info.subtitle && <div className="font-mono text-[11px] text-muted">{info.subtitle}</div>}
      <p className="mt-1 text-xs leading-relaxed text-muted">{info.text}</p>
    </div>
  );
}
