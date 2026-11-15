/**
 * Module F – HA lab: the HQ vSphere cluster as a playground.
 *
 * Top: network, storage and power components. Middle: the three hosts with their VMs.
 * Side: what happens (log), the effect on the sites, lost safety margins.
 * Below: load and admission control, DRS, anti-affinity, host isolation, the single-point-of-
 * failure table and the "before" picture (one server per service).
 */
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Info, RotateCcw, Server, ShieldAlert, XCircle } from 'lucide-react';
import { CLUSTER, INDEX } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import { admission, failureImpact, imbalance, ruleStatus, type IsolationResponse } from '../../engine/haLab';
import { Segmented } from '../../components/common/Segmented';
import { serviceLabel, siteLabel } from '../../components/map/labels';
import { cn } from '../../utils/cn';
import { useSimText } from '../b-simulator/useSimText';
import { Card, ComponentToggle, HostCard, OffTray, useLabNames } from './parts';
import { useHaLab, type HaLab } from './useHaLab';

const INFRA: Array<{ key: 'internet' | 'firewall' | 'core' | 'storage' | 'power'; ids: string[] }> = [
  { key: 'internet', ids: ['hq-isp1', 'hq-isp2'] },
  { key: 'firewall', ids: ['hq-fw1', 'hq-fw2'] },
  { key: 'core', ids: ['hq-core1', 'hq-core2'] },
  { key: 'storage', ids: CLUSTER.storage.controllers },
  { key: 'power', ids: ['hq-ups-a', 'hq-ups-b'] },
];

function Infrastructure({ lab }: { lab: HaLab }) {
  const { t } = useI18n();
  const { mode } = usePrefs();
  const ports = INDEX.topology.links.filter((l) => l.kind === 'storage' && CLUSTER.storage.controllers.some((c) => c === l.a.device || c === l.b.device));
  return (
    <Card title={t('ha.infra.title')}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {INFRA.map((g) => (
          <div key={g.key}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t(`ha.infra.${g.key}`)}</h3>
            <div className="flex flex-wrap gap-1.5">
              {g.ids.map((id) => (
                <ComponentToggle key={id} lab={lab} id={id} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {mode === 'technical' && (
        <div className="mt-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t('ha.infra.paths')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {ports.map((l) => (
              <ComponentToggle key={l.id} lab={lab} id={l.id} />
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">{t('ha.infra.storageNote')}</p>
    </Card>
  );
}

/** Tone of a log line: something broke (red), something recovered (green), or neither */
const LOG_TONE: Record<string, 'bad' | 'ok'> = {
  'ha.log.componentFailed': 'bad',
  'ha.log.hostFailed': 'bad',
  'ha.log.hostNoNetwork': 'bad',
  'ha.log.hostNoStorage': 'bad',
  'ha.log.noCapacity': 'bad',
  'ha.log.stuck': 'bad',
  'ha.log.isolated': 'bad',
  'ha.log.componentRestored': 'ok',
  'ha.log.restored': 'ok',
  'ha.log.restarted': 'ok',
  'ha.log.reconnected': 'ok',
  'ha.log.migrated': 'ok',
  'ha.log.maintenanceDone': 'ok',
  'ha.log.isolatedKeep': 'ok',
  'ha.log.noImpact': 'ok',
};
const TONE_STYLE = {
  bad: { icon: XCircle, text: 'text-bad', srKey: 'ha.log.toneBad' },
  ok: { icon: CheckCircle2, text: 'text-ok', srKey: 'ha.log.toneOk' },
} as const;

function LogPanel({ lab }: { lab: HaLab }) {
  const { t, td } = useI18n();
  const { params } = useLabNames();
  return (
    <Card title={t('ha.log.title')}>
      {lab.log.length === 0 && <p className="text-sm text-muted">{t('ha.log.empty')}</p>}
      <div className="space-y-3" aria-live="polite">
        {lab.log.map((g, gi) => (
          <ol key={g.id} className={cn('space-y-1 border-l-2 pl-3 text-sm', gi === 0 ? 'border-primary' : 'border-line opacity-70')}>
            {g.lines.map((l, i) => (
              <LogItem key={i} at={l.at} tone={LOG_TONE[l.key]} first={i === 0} text={td(l.key, params(l.params) as Record<string, string | number>)} />
            ))}
          </ol>
        ))}
      </div>
    </Card>
  );
}

function LogItem({ at, tone, first, text }: { at: number; tone?: 'bad' | 'ok'; first: boolean; text: string }) {
  const { t } = useI18n();
  const style = tone ? TONE_STYLE[tone] : null;
  const Icon = style?.icon ?? Circle;
  return (
    <li className="flex gap-2">
      <span className="w-12 shrink-0 text-right font-mono text-xs leading-5 text-muted">{t('ha.log.time', { sec: at })}</span>
      <Icon className={style ? cn('mt-0.5 h-4 w-4 shrink-0', style.text) : 'mx-[3px] mt-1.5 h-2.5 w-2.5 shrink-0 text-muted'} aria-hidden="true" />
      <span className={cn('min-w-0', style ? style.text : 'text-ink', first && 'font-medium')}>
        {style && <span className="sr-only">{t(style.srKey)}: </span>}
        {text}
      </span>
    </li>
  );
}

function Effects({ lab }: { lab: HaLab }) {
  const { t, td } = useI18n();
  const { text } = useSimText();
  const { dev, list } = useLabNames();
  const net = lab.net;
  const clinics = INDEX.topology.sites.filter((s) => s.kind === 'clinic' && s.status === 'live');
  const tunnelState = (site: string) => {
    if (net.sites[site]?.vpn === 'down') return 'down';
    const degraded = INDEX.topology.links.some((l) => l.kind === 'vpn' && INDEX.devices.get(l.a.device)?.site === site && net.links[l.id]?.state === 'degraded');
    return degraded ? 'backup' : 'up';
  };
  const hq = net.sites.hq?.wan ?? 'primary';
  const icon = (s: string) => (s === 'down' || s === 'offline' ? <XCircle className="h-4 w-4 shrink-0 text-bad" aria-hidden="true" /> : s === 'up' || s === 'primary' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />);

  // Lost safety margins: from the network engine (pairs, UPS, cluster reserve) and from the lab (uplinks, paths, maintenance, rules)
  const warnings: string[] = net.warnings.map((w) => {
    if (w.kind === 'on-battery') return text({ key: 'faults.warning.onBattery', params: { device: w.subject } });
    if (w.kind === 'service-redundancy-lost') return text({ key: 'faults.warning.serviceRedundancyLost', params: { service: w.subject, devices: w.missing } });
    if (w.kind === 'capacity-reserve-used') return text({ key: 'faults.warning.capacityReserveUsed', params: { devices: w.missing } });
    return text({ key: 'faults.warning.redundancyLost', params: { devices: w.missing } });
  });
  const ok = Object.values(lab.health).filter((h) => h.status === 'ok' || h.status === 'maintenance' || h.status === 'isolated');
  const oneUplink = ok.filter((h) => h.uplinks.filter((u) => u.up).length === 1).map((h) => dev(h.id));
  if (oneUplink.length) warnings.push(t('ha.warn.uplink', { host: list(oneUplink) }));
  const fewPaths = ok.filter((h) => h.storagePaths > 0 && h.storagePaths < h.storagePathsTotal);
  for (const count of [...new Set(fewPaths.map((h) => h.storagePaths))]) {
    const hosts = fewPaths.filter((h) => h.storagePaths === count).map((h) => dev(h.id));
    warnings.push(t('ha.warn.paths', { host: list(hosts), count, total: fewPaths[0].storagePathsTotal }));
  }
  for (const h of lab.controls.maintenance) warnings.push(t('ha.warn.maintenance', { host: dev(h) }));
  if (ruleStatus(lab.cluster, lab.runtime).some((r) => r.state === 'violated')) warnings.push(t('ha.warn.antiAffinity'));

  return (
    <>
      <Card title={t('ha.effects.title')}>
        <ul className="space-y-1.5 text-sm text-ink">
          <li className="flex items-start gap-2">
            {icon(hq)}
            {t(`ha.effects.hqWan.${hq}`)}
          </li>
          {clinics.map((s) => {
            const st = tunnelState(s.id);
            return (
              <li key={s.id} className="flex items-start gap-2">
                {icon(st)}
                {t(`ha.effects.tunnel.${st}`, { site: siteLabel(td, s.id) })}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title={t('ha.warnings.title')}>
        {warnings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink">
            <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden="true" />
            {t('ha.warnings.none')}
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm text-ink">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                {w}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function LoadPanel({ lab }: { lab: HaLab }) {
  const { t } = useI18n();
  const { dev, vm, list } = useLabNames();
  const a = admission(lab.cluster);
  const impact = failureImpact(lab.cluster, lab.runtime, lab.health);
  return (
    <Card title={t('ha.load.title')} collapsible>
      <label htmlFor="ha-load" className="flex justify-between text-sm text-ink">
        <span>{t('ha.load.label')}</span>
        <span className="font-semibold">{t('ha.load.value', { pct: Math.round(a.usedPct), total: a.capacityGb })}</span>
      </label>
      <input
        id="ha-load"
        type="range"
        min={30}
        max={95}
        step={1}
        value={lab.load}
        onChange={(e) => lab.setLoad(Number(e.target.value))}
        className="mt-2 h-11 w-full accent-[var(--c-primary)]"
      />
      <div className="relative h-3 overflow-hidden rounded-full bg-raised" aria-hidden="true">
        <div className={cn('h-full', a.ok ? 'bg-primary' : 'bg-bad')} style={{ width: `${a.usedPct}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${a.limitPct}%` }} />
      </div>
      <p className="mt-1 text-right text-xs text-muted">{t('ha.load.limit', { pct: Math.round(a.limitPct) })}</p>
      <p className={cn('mt-2 flex items-start gap-2 text-sm font-medium', a.ok ? 'text-ok' : 'text-bad')}>
        {a.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="text-ink">{a.ok ? t('ha.load.ok') : t('ha.load.over')}</span>
      </p>
      {!a.ok && <p className="mt-1 text-xs leading-relaxed text-muted">{t('ha.load.ac', { pct: Math.round(a.limitPct) })}</p>}
      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{t('ha.load.ifFails')}</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {impact.map((r) => (
          <li key={r.host} className="flex items-start gap-2 text-ink">
            {r.lost.length === 0 ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden="true" />}
            {r.lost.length === 0 ? t('ha.load.allRestart', { host: dev(r.host) }) : t('ha.load.lost', { host: dev(r.host), vms: list(r.lost.map(vm)) })}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DrsPanel({ lab }: { lab: HaLab }) {
  const { t } = useI18n();
  const { dev, vm } = useLabNames();
  const usable = Object.values(lab.health).filter((h) => h.status === 'ok').map((h) => h.id);
  const spread = Math.round(imbalance(lab.cluster, lab.runtime, usable));
  const busy = Object.keys(lab.display).length > 0;
  return (
    <Card title={t('ha.drs.title')} collapsible>
      {!lab.vcenterUp ? (
        <p className="flex items-start gap-2 text-sm text-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          {t('ha.drs.noVcenter')}
        </p>
      ) : lab.moves.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
          {t('ha.drs.balanced')}
        </p>
      ) : (
        <>
          <p className="text-sm text-ink">{t('ha.drs.recommend', { pct: spread })}</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-ink">
            {lab.moves.map((m) => (
              <li key={m.vm}>{t('ha.drs.move', { vm: vm(m.vm), from: dev(m.from), to: dev(m.to) })}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => lab.applyDrs(lab.moves)}
            className="mt-3 min-h-11 rounded-xl bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-50"
          >
            {t('ha.drs.apply')}
          </button>
        </>
      )}
    </Card>
  );
}

function RulesAndIsolation({ lab }: { lab: HaLab }) {
  const { t } = useI18n();
  const { vm } = useLabNames();
  return (
    <>
      <Card title={t('ha.rule.title')} collapsible>
        <ul className="space-y-1.5 text-sm text-ink">
          {ruleStatus(lab.cluster, lab.runtime).map((r) => (
            <li key={r.vms.join()} className="flex items-start gap-2">
              {r.state === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />}
              {t(`ha.rule.${r.state}`, { a: vm(r.vms[0]), b: vm(r.vms[1]) })}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('ha.isolation.title')} collapsible>
        <p className="text-sm leading-relaxed text-ink">{t('ha.isolation.text')}</p>
        <div className="mt-3">
          <Segmented<IsolationResponse>
            label={t('ha.isolation.response')}
            value={lab.controls.response}
            onChange={lab.setResponse}
            className="flex w-full flex-wrap"
            options={[
              { value: 'keep-running', label: t('ha.isolation.keep') },
              { value: 'power-off', label: t('ha.isolation.poweroff') },
            ]}
          />
        </div>
      </Card>
    </>
  );
}

function SpofTable({ onTry }: { onTry: (id: string) => void }) {
  const { t, td } = useI18n();
  return (
    <Card title={t('ha.spof.title')} collapsible>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2 pr-3 font-semibold">{t('ha.spof.col.component')}</th>
              <th className="py-2 pr-3 font-semibold">{t('ha.spof.col.how')}</th>
              <th className="py-2 pr-3 font-semibold">{t('ha.spof.col.fails')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {CLUSTER.spof.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="py-2.5 pr-3 font-medium text-ink">{td(`ha.spof.${row.id}.component`)}</td>
                <td className="py-2.5 pr-3 text-ink">{td(`ha.spof.${row.id}.how`)}</td>
                <td className="py-2.5 pr-3 text-muted">{td(`ha.spof.${row.id}.fails`)}</td>
                <td className="py-1.5 text-right">
                  {row.try && (
                    <button type="button" onClick={() => onTry(row.try!.id)} className="min-h-11 whitespace-nowrap rounded-lg border border-line px-3 text-xs font-medium text-ink hover:border-bad hover:bg-bad-soft">
                      {t('ha.spof.try')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BeforePicture() {
  const { t, td } = useI18n();
  const [down, setDown] = useState<ReadonlySet<string>>(new Set());
  return (
    <Card title={t('ha.before.title')} collapsible>
      <p className="text-sm leading-relaxed text-ink">{t('ha.before.text')}</p>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {CLUSTER.before.map((s) => {
          const off = down.has(s);
          const name = serviceLabel(td, s);
          return (
            <li key={s}>
              <button
                type="button"
                aria-pressed={off}
                aria-label={t('ha.before.fail', { service: name })}
                onClick={() =>
                  setDown((cur) => {
                    const next = new Set(cur);
                    if (!next.delete(s)) next.add(s);
                    return next;
                  })
                }
                className={cn('flex h-full min-h-20 w-full flex-col items-start gap-1 rounded-xl border p-2.5 text-left text-xs', off ? 'border-bad bg-bad-soft' : 'border-line bg-raised/60 hover:border-bad')}
              >
                <Server className={cn('h-5 w-5', off ? 'text-bad' : 'text-muted')} aria-hidden="true" />
                <span className="font-semibold text-ink">{name}</span>
                <span className={cn('flex items-center gap-1 font-medium', off ? 'text-bad' : 'text-ok')}>
                  {off ? <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  {off ? t('ha.before.down') : t('ha.before.up')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {down.size > 0 && <p className="mt-3 text-sm font-medium text-ink">{t('ha.before.now')}</p>}
    </Card>
  );
}

export function HaLabPage() {
  const { t } = useI18n();
  const { mode } = usePrefs();
  const lab = useHaLab();
  const boardRef = useRef<HTMLDivElement>(null);

  const tryComponent = (id: string) => {
    lab.breakComponent(id);
    boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('ui.modules.haLab.title')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t(`ui.modules.haLab.${mode}`)}</p>
        </div>
        <button type="button" onClick={lab.reset} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-raised">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {t('ha.reset')}
        </button>
      </div>
      <p className="mt-3 flex items-start gap-2 rounded-xl border border-accent bg-accent-soft px-3 py-2 text-sm text-ink">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden="true" />
        <span>
          {t('ha.restartNote')} <span className="text-muted">{t('ha.illustrative')}</span>
        </span>
      </p>

      <div ref={boardRef} className="mt-5 scroll-mt-4 space-y-4">
        <Infrastructure lab={lab} />
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {lab.cluster.hosts.map((h) => (
                <HostCard key={h.id} lab={lab} host={h.id} />
              ))}
            </div>
            <p className="flex items-center gap-2 text-xs text-muted">
              <span className="h-3.5 w-5 shrink-0 rounded border border-virtual/50 bg-virtual-soft" aria-hidden="true" />
              {t('ha.vmKey')}
            </p>
            <OffTray lab={lab} />
          </div>
          <div className="space-y-4">
            <LogPanel lab={lab} />
            <Effects lab={lab} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
        <LoadPanel lab={lab} />
        <DrsPanel lab={lab} />
        <RulesAndIsolation lab={lab} />
      </div>
      <div className="mt-4 space-y-4">
        <SpofTable onTry={tryComponent} />
        <BeforePicture />
      </div>
    </div>
  );
}
