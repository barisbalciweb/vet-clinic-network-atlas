/**
 * A link line, straight from node centre to node centre.
 *
 * The pattern shows the kind of link (cable solid, Wi-Fi dotted, VPN dashed, ...), so the kind
 * never depends on colour alone. The state is shown by colour AND a marker:
 *   degraded  amber line with a "!" marker
 *   down      red dashed line with a "✕" marker
 *   standby / planned  lighter line
 * Links of the selected device are drawn thicker.
 */
import { memo } from 'react';
import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { INDEX } from '../../data';
import type { LinkKind } from '../../schema/topology.schema';
import type { LinkFlowEdge } from '../../utils/layout';
import { useMapUi } from './MapUiContext';
import type { LinkState } from './linkState';

const PARALLEL_GAP = 9;

export const LINK_STYLE: Record<LinkKind, { color: string; width: number; dash?: string; cap?: 'round' }> = {
  lan: { color: 'var(--link-lan)', width: 1.6 },
  wifi: { color: 'var(--link-wifi)', width: 2.2, dash: '0.1 6', cap: 'round' },
  wan: { color: 'var(--link-wan)', width: 2.4 },
  vpn: { color: 'var(--link-vpn)', width: 2.6, dash: '9 5' },
  storage: { color: 'var(--link-storage)', width: 1.8, dash: '14 3 2 3' },
  virtual: { color: 'var(--link-virtual)', width: 1.4, dash: '3 4' },
};

const BASE_OPACITY: Record<LinkState, number> = { up: 1, degraded: 1, down: 1, standby: 0.5, planned: 0.35 };

export const LinkEdge = memo(function LinkEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<LinkFlowEdge>) {
  const { selectedId, linkState, highlight } = useMapUi();
  const link = INDEX.links.get(data?.linkId ?? id);
  if (!link) return null;

  // Offset parallel links between the same two nodes sideways
  let sx = sourceX, sy = sourceY, tx = targetX, ty = targetY;
  const parallel = data?.parallelCount ?? 1;
  if (parallel > 1) {
    const offset = ((data?.parallelIndex ?? 0) - (parallel - 1) / 2) * PARALLEL_GAP;
    const len = Math.hypot(tx - sx, ty - sy) || 1;
    const nx = (-(ty - sy) / len) * offset;
    const ny = ((tx - sx) / len) * offset;
    sx += nx; sy += ny; tx += nx; ty += ny;
  }
  const mid = { x: (sx + tx) / 2, y: (sy + ty) / 2 };

  const state = linkState(link.id);
  const style = LINK_STYLE[link.kind];
  const ofSelected = selectedId !== null && (link.a.device === selectedId || link.b.device === selectedId);
  const touchesHighlight = !!highlight && (highlight.has(link.a.device) || highlight.has(link.b.device));
  const dimmed = (selectedId !== null && !ofSelected) || (highlight !== null && selectedId === null && !touchesHighlight);
  const opacity = BASE_OPACITY[state] * (dimmed ? 0.35 : 1);

  return (
    <>
      <BaseEdge
        id={id}
        path={`M ${sx},${sy} L ${tx},${ty}`}
        interactionWidth={0}
        style={{
          stroke: state === 'down' ? 'var(--c-bad)' : state === 'degraded' ? 'var(--c-warn)' : style.color,
          strokeWidth: ofSelected ? style.width + 1.6 : style.width,
          strokeDasharray: state === 'down' ? '5 7' : style.dash,
          strokeLinecap: style.cap ?? 'butt',
          opacity,
          transition: 'opacity 150ms, stroke-width 150ms',
        }}
      />
      {state === 'down' && (
        <g transform={`translate(${mid.x} ${mid.y})`} opacity={dimmed ? 0.35 : 1}>
          <circle r={9} fill="var(--c-surface)" stroke="var(--c-bad)" strokeWidth={2} />
          <path d="M-3.6 -3.6 L3.6 3.6 M3.6 -3.6 L-3.6 3.6" stroke="var(--c-bad)" strokeWidth={2.2} strokeLinecap="round" />
        </g>
      )}
      {state === 'degraded' && (
        <g transform={`translate(${mid.x} ${mid.y})`} opacity={dimmed ? 0.35 : 1}>
          <path d="M0 -10 L10 8 L-10 8 Z" fill="var(--c-surface)" stroke="var(--c-warn)" strokeWidth={2} strokeLinejoin="round" />
          <path d="M0 -3.5 V2.5 M0 5.4 V5.5" stroke="var(--c-warn)" strokeWidth={2.2} strokeLinecap="round" />
        </g>
      )}
    </>
  );
});
