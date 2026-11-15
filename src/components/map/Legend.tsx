/**
 * Explains what is on the current canvas: the line patterns and – if any link or device is
 * not healthy – the status markers. Collapsed by default on phones.
 */
import { AlertTriangle, XCircle, Zap } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import type { LinkKind } from '../../schema/topology.schema';
import { LINK_STYLE } from './LinkEdge';
import type { LinkState } from './linkState';

interface Props {
  kinds: LinkKind[];
  states: ReadonlySet<LinkState>;
  /** Explain the device badges (only while something is broken) */
  deviceStates?: boolean;
  /** Leave room for the simulator's bottom sheet on phones */
  raised?: boolean;
}

export function Legend({ kinds, states, deviceStates = false, raised = false }: Props) {
  const t = useT();
  const isMobile = useIsMobile();
  if (kinds.length === 0) return null;
  return (
    <details open={!isMobile} className={`absolute ${raised ? 'bottom-20 md:bottom-3' : 'bottom-3'} left-3 z-10 max-h-[calc(100%-1.5rem)] max-w-[15rem] overflow-y-auto rounded-xl border border-line bg-surface/95 text-xs text-ink shadow-sm backdrop-blur`}>
      <summary className="flex min-h-11 cursor-pointer items-center px-3 font-semibold sm:min-h-9">{t('map.legend.title')}</summary>
      <ul className="space-y-1.5 px-3 pb-3">
        {kinds.map((kind) => {
          const s = LINK_STYLE[kind];
          return (
            <li key={kind} className="flex items-center gap-2">
              <svg width="34" height="8" className="shrink-0" aria-hidden="true">
                <line x1="1" y1="4" x2="33" y2="4" stroke={s.color} strokeWidth={s.width + 0.4} strokeDasharray={s.dash} strokeLinecap={s.cap ?? 'butt'} />
              </svg>
              {t(`map.legend.${kind}`)}
            </li>
          );
        })}
        {(states.has('standby') || states.has('planned')) && <li className="text-muted">{t('map.legend.backup')}</li>}


        {states.has('degraded') && (
          <li className="flex items-center gap-2 border-t border-line pt-2">
            <svg width="34" height="16" viewBox="-17 -9 34 16" className="shrink-0" aria-hidden="true">
              <path d="M0 -8 L8 6 L-8 6 Z" fill="var(--c-surface)" stroke="var(--c-warn)" strokeWidth={1.8} strokeLinejoin="round" />
              <path d="M0 -3 V1.6 M0 4 V4.1" stroke="var(--c-warn)" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
            {t('map.legend.degraded')}
          </li>
        )}
        {deviceStates && (
          <>
            <li className="flex items-center gap-2 border-t border-line pt-2">
              <XCircle className="h-4 w-4 shrink-0 text-bad" aria-hidden="true" />
              {t('sim.legendDown')}
            </li>
            <li className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              {t('sim.legendDegraded')}
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-bad text-white" aria-hidden="true">
                <Zap className="h-2.5 w-2.5" />
              </span>
              {t('sim.legendFault')}
            </li>
          </>
        )}
        {states.has('down') && (
          <li className={states.has('degraded') ? 'flex items-center gap-2' : 'flex items-center gap-2 border-t border-line pt-2'}>
            <svg width="34" height="16" viewBox="-17 -8 34 16" className="shrink-0" aria-hidden="true">
              <circle r={7} fill="var(--c-surface)" stroke="var(--c-bad)" strokeWidth={1.8} />
              <path d="M-2.8 -2.8 L2.8 2.8 M2.8 -2.8 L-2.8 2.8" stroke="var(--c-bad)" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
            {t('map.legend.down')}
          </li>
        )}
      </ul>
    </details>
  );
}
