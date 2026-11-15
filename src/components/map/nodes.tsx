/**
 * The node types of the map: device, zone (room box), portal (way to a neighbouring site),
 * site (overview) and the Germany backdrop.
 * Clickable nodes are real buttons, so they are reachable by keyboard and have an accessible name.
 * Links attach to the centre of a node (invisible centre handles).
 */
import { memo, useRef, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, ArrowUpRight, Building2, Cloud, Stethoscope, XCircle, Zap } from 'lucide-react';
import type { Quality } from '../../engine/types';
import { CategoryIcons } from '../../modules/g-privacy/PrivacyPage';
import { INDEX } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import { cn } from '../../utils/cn';
import { MAP_H, MAP_SCALE, MAP_W, type DeviceFlowNode, type PortalFlowNode, type SiteFlowNode, type ZoneFlowNode } from '../../utils/layout';
import { RoleIcon } from './RoleIcon';
import { useMapUi } from './MapUiContext';
import { devicePrimary, roleLabel, roleSummary, siteLabel, zoneLabel } from './labels';

function CenterHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} className="center-handle" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="center-handle" isConnectable={false} />
    </>
  );
}

/** Button that reports a hover summary for the element it wraps (mouse only). */
function HoverButton(props: { title: string; subtitle?: string; text: string; onClick: () => void; className: string; label: string; children: ReactNode }) {
  const { setHover } = useMapUi();
  const ref = useRef<HTMLButtonElement>(null);
  const show = () => ref.current && setHover({ title: props.title, subtitle: props.subtitle, text: props.text, rect: ref.current.getBoundingClientRect() });
  return (
    <button
      ref={ref}
      type="button"
      aria-label={props.label}
      onClick={props.onClick}
      onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
      onPointerLeave={() => setHover(null)}
      onFocus={show}
      onBlur={() => setHover(null)}
      className={props.className}
    >
      {props.children}
    </button>
  );
}

/** Badge in the corner of a node: red cross = not working, amber triangle = slow or interrupted */
function StateBadge({ state }: { state: Quality | undefined }) {
  if (!state || state === 'up') return null;
  const Icon = state === 'down' ? XCircle : AlertTriangle;
  return (
    <span className={cn('absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-surface shadow', state === 'down' ? 'text-bad' : 'text-warn')} aria-hidden="true">
      <Icon className="h-5 w-5" />
    </span>
  );
}

const STATE_RING: Record<Quality, string> = { up: '', degraded: 'border-warn ring-1 ring-warn', down: 'border-bad ring-1 ring-bad bg-bad-soft' };

const LAYER_TONE: Record<string, string> = {
  infrastructure: 'bg-primary-soft text-primary-strong',
  endpoint: 'bg-raised text-ink',
  server: 'bg-accent-soft text-accent-ink',
  external: 'bg-raised text-muted',
};

export const DeviceNode = memo(function DeviceNode({ data }: NodeProps<DeviceFlowNode>) {
  const { td } = useI18n();
  const { mode } = usePrefs();
  const { t } = useI18n();
  const { selectedId, selectDevice, planned, deviceState, highlight, privacyCats } = useMapUi();
  const device = INDEX.devices.get(data.deviceId);
  if (!device) return null;
  const sim = deviceState(device.id);
  const lit = highlight?.has(device.id) ?? false;
  const faded = highlight !== null && !lit && selectedId !== device.id;
  const role = INDEX.roles.get(device.role);
  const selected = selectedId === device.id;
  const primary = devicePrimary(td, device, mode);
  const address = device.ip ?? (device.dhcp ? 'DHCP' : '');
  const secondary = mode === 'technical' ? [address, device.vlan !== undefined ? `VLAN ${device.vlan}` : ''].filter(Boolean).join(' · ') : '';
  const vlan = device.vlan !== undefined ? INDEX.vlans.get(device.vlan) : undefined;

  return (
    <>
      <CenterHandles />
      <HoverButton
        title={roleLabel(td, device.role)}
        subtitle={device.name}
        text={roleSummary(td, device.role, mode)}
        label={[roleLabel(td, device.role), device.name, sim && sim.state !== 'up' && t(`sim.state.${sim.state}`), sim?.faulted && t('sim.faulted')].filter(Boolean).join(', ')}
        onClick={() => selectDevice(device.id)}
        className={cn(
          'relative flex h-full w-full items-center gap-2.5 rounded-xl border bg-surface px-2.5 text-left shadow-sm transition-shadow hover:shadow-md',
          selected ? 'border-primary ring-2 ring-primary' : lit ? 'border-accent ring-2 ring-accent' : sim ? STATE_RING[sim.state] || 'border-line' : 'border-line',
          planned && 'border-dashed opacity-70',
          faded && 'opacity-40',
        )}
      >
        {sim?.faulted && (
          <span className="absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-bad text-white shadow" aria-hidden="true">
            <Zap className="h-3.5 w-3.5" />
          </span>
        )}
        <StateBadge state={sim?.state} />
        {privacyCats && (privacyCats(device.id)?.length ?? 0) > 0 && <CategoryIcons categories={privacyCats(device.id)!} className="absolute -bottom-2.5 right-2 rounded-full bg-surface px-0.5 shadow" />}
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', LAYER_TONE[role?.layer ?? 'endpoint'])}>
          <RoleIcon icon={role?.icon} className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-semibold text-ink">{primary}</span>
          {secondary && <span className="block truncate text-[11px] text-muted">{secondary}</span>}
        </span>
        {vlan && mode === 'simple' && <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: vlan.color }} aria-hidden="true" />}
      </HoverButton>
    </>
  );
});

export const ZoneNode = memo(function ZoneNode({ data }: NodeProps<ZoneFlowNode>) {
  const { td } = useI18n();
  const { planned } = useMapUi();
  const zone = INDEX.zones.get(data.zoneId);
  if (!zone) return null;
  return (
    <div className={cn('h-full w-full rounded-2xl border bg-raised/60', planned ? 'border-dashed border-line' : 'border-line')}>
      <div className="truncate px-3.5 pt-2.5 text-xs font-semibold uppercase tracking-wide text-muted">{zoneLabel(td, zone)}</div>
    </div>
  );
});

const SITE_ICON = { hq: Building2, clinic: Stethoscope, external: Cloud };

export const PortalNode = memo(function PortalNode({ data }: NodeProps<PortalFlowNode>) {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const { openSite, highlight, siteStatus } = useMapUi();
  const site = INDEX.sites.get(data.siteId);
  if (!site) return null;
  const Icon = SITE_ICON[site.kind];
  const name = siteLabel(td, site.id);
  // The way to a site that holds highlighted devices is highlighted too
  const lit = !!highlight && [...highlight].some((id) => INDEX.devices.get(id)?.site === site.id);
  return (
    <>
      <CenterHandles />
      <HoverButton
        title={name}
        text={site.status === 'planned' && siteStatus(site.id) === 'live' ? td(`opening.nowLive.${mode}`) : td(`topology.site.${site.id}.${mode}`)}
        label={t('map.portal.goto', { site: name })}
        onClick={() => openSite(site.id)}
        className={cn(
          'flex h-full w-full items-center gap-2.5 rounded-full border border-dashed bg-surface px-4 text-left shadow-sm hover:bg-primary-soft',
          lit ? 'border-accent ring-2 ring-accent' : 'border-primary',
        )}
      >
        <Icon className="h-5 w-5 shrink-0 text-primary-strong" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{name}</span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      </HoverButton>
    </>
  );
});

export const SiteNode = memo(function SiteNode({ data }: NodeProps<SiteFlowNode>) {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const { openSite, siteState, siteStatus } = useMapUi();
  const site = INDEX.sites.get(data.siteId);
  if (!site) return null;
  const Icon = SITE_ICON[site.kind];
  const name = siteLabel(td, site.id);
  const planned = siteStatus(site.id) === 'planned';
  const opened = site.status === 'planned' && !planned;
  const state = siteState(site.id);
  const count = INDEX.devicesOfSite(site.id).length;
  const secondary = planned
    ? t('map.site.planned')
    : mode === 'technical' && site.number !== undefined
      ? `10.${site.number}.x.0/24`
      : t('map.site.devices', { count });

  return (
    <>
      <CenterHandles />
      <HoverButton
        title={name}
        text={opened ? td(`opening.nowLive.${mode}`) : td(`topology.site.${site.id}.${mode}`)}
        label={[t('map.site.open', { site: name }), state && state !== 'up' && t(`sim.state.${state}`)].filter(Boolean).join(', ')}
        onClick={() => openSite(site.id)}
        className={cn(
          'relative flex h-full w-full items-center gap-2.5 rounded-2xl border-2 px-3 text-left shadow-md transition-shadow hover:shadow-lg',
          planned
            ? 'border-dashed border-muted bg-surface/80'
            : state === 'down'
              ? 'border-bad bg-surface'
              : state === 'degraded'
                ? 'border-warn bg-surface'
                : site.kind === 'hq'
                  ? 'border-primary bg-surface'
                  : 'border-line bg-surface',
        )}
      >
        <StateBadge state={state} />
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            site.kind === 'hq' ? 'bg-primary text-on-primary' : site.kind === 'clinic' ? 'bg-primary-soft text-primary-strong' : 'bg-raised text-muted',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-semibold text-ink">{name}</span>
          <span className={cn('block truncate text-[11px]', planned ? 'font-medium text-accent-ink' : 'text-muted')}>{secondary}</span>
        </span>
      </HoverButton>
    </>
  );
});

/**
 * Simplified outline of Germany (own drawing, about 30 points) in map units 0–100 × 0–122.
 * Purely decorative: the sites carry all information.
 */
export const GERMANY_PATH =
  'M38 2 L46 5 L48 12 L60 10 L72 7 L80 14 L82 29 L84 43 L86 58 L78 65 L70 70 L64 74 L72 86 L78 98 L72 106 L74 115 L62 115 L50 118 L40 115 L30 118 L26 108 L30 96 L20 91 L14 84 L12 72 L10 60 L12 48 L16 38 L14 29 L18 17 L28 14 L34 17 L36 7 Z';

export const BackdropNode = memo(function BackdropNode() {
  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} width={MAP_W * MAP_SCALE} height={MAP_H * MAP_SCALE} className="pointer-events-none" aria-hidden="true">
      <path d={GERMANY_PATH} className="fill-primary-soft stroke-primary" strokeWidth={0.5} strokeLinejoin="round" opacity={0.55} />
    </svg>
  );
});
