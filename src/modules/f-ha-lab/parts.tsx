/**
 * Building blocks of the HA lab page: names, component toggles, host cards, VM tiles, panels.
 * Status is always icon + word, never colour alone.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, ArrowLeftRight, CheckCircle2, RotateCcw, Server, Wrench, XCircle, ZapOff, type LucideIcon } from 'lucide-react';
import { INDEX } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import type { HostStatus } from '../../engine/haLab';
import { roleLabel } from '../../components/map/labels';
import { cn } from '../../utils/cn';
import type { HaLab, LogParams } from './useHaLab';
import { Collapsible } from '../../components/common/Collapsible';

export function useLabNames() {
  const { td, lang } = useI18n();
  const { mode } = usePrefs();
  const dev = (id: string) => INDEX.devices.get(id)?.name ?? id;
  const vm = (id: string) => (mode === 'technical' ? dev(id) : roleLabel(td, INDEX.devices.get(id)?.role ?? ''));
  /** A device, or a link: "HQ-ESX-01 vmnic0" for a host uplink, "HQ-SAN-A – HQ-CORE-01" otherwise */
  const component = (id: string) => {
    if (INDEX.devices.has(id)) return dev(id);
    const l = INDEX.links.get(id);
    if (!l) return id;
    const host = [l.a, l.b].find((end) => INDEX.devices.get(end.device)?.role === 'esxi-host');
    if (host) return `${dev(host.device)} ${host.port ?? ''}`.trim();
    return `${dev(l.a.device)} – ${dev(l.b.device)}`;
  };
  const list = (names: string[]) => new Intl.ListFormat(lang, { type: 'conjunction' }).format(names);
  /** Resolves the ids of a log line */
  const params = (p: LogParams) => ({
    ...p,
    host: p.host ? dev(p.host) : undefined,
    vm: p.vm ? vm(p.vm) : undefined,
    name: p.name ? component(p.name) : undefined,
  });
  return { dev, vm, component, list, params };
}

/** `collapsible`: a deeper topic, closed until opened (keeps the page simple at first glance) */
export function Card({ title, children, className, aside, collapsible }: { title: string; children: ReactNode; className?: string; aside?: ReactNode; collapsible?: boolean }) {
  if (collapsible)
    return (
      <Collapsible variant="card" className={cn('self-start', className)} summary={<span className="text-sm font-semibold">{title}</span>}>
        {aside && <div className="mb-2">{aside}</div>}
        {children}
      </Collapsible>
    );
  return (
    <section className={cn('rounded-2xl border border-line bg-surface p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A device or link the user can break and repair. */
export function ComponentToggle({ lab, id }: { lab: HaLab; id: string }) {
  const { t } = useI18n();
  const { component } = useLabNames();
  const userBroke = lab.controls.failed.has(id);
  // Also "down" when it lost power because of something else (a UPS)
  const down = userBroke || (INDEX.devices.has(id) && lab.net.devices[id]?.on === false);
  const Icon = down ? XCircle : CheckCircle2;
  const name = component(id);
  return (
    <button
      type="button"
      onClick={() => lab.toggleComponent(id)}
      aria-pressed={userBroke}
      aria-label={userBroke ? t('ha.toggle.restore', { name }) : t('ha.toggle.fail', { name })}
      title={userBroke ? t('ha.toggle.restore', { name }) : t('ha.toggle.fail', { name })}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-2.5 font-mono text-xs font-medium',
        down ? 'border-bad bg-bad-soft text-ink' : 'border-line bg-surface text-ink hover:border-bad',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', down ? 'text-bad' : 'text-ok')} aria-hidden="true" />
      {name}
    </button>
  );
}

const HOST_STATUS: Record<HostStatus, { icon: LucideIcon; tone: string }> = {
  ok: { icon: CheckCircle2, tone: 'text-ok' },
  failed: { icon: XCircle, tone: 'text-bad' },
  'no-network': { icon: XCircle, tone: 'text-bad' },
  'no-storage': { icon: XCircle, tone: 'text-bad' },
  maintenance: { icon: Wrench, tone: 'text-warn' },
  isolated: { icon: ZapOff, tone: 'text-warn' },
};

function Bar({ value, max, marker }: { value: number; max: number; marker?: number }) {
  const pct = Math.min(100, (100 * value) / max);
  const over = value > max * 0.9;
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-raised">
      <div className={cn('h-full rounded-full', over ? 'bg-warn' : 'bg-primary')} style={{ width: `${pct}%` }} />
      {marker !== undefined && <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${marker}%` }} aria-hidden="true" />}
    </div>
  );
}

function VmTile({ lab, vm, from }: { lab: HaLab; vm: string; from?: 'down' | 'migrating' }) {
  const { t } = useI18n();
  const { mode } = usePrefs();
  const { vm: vmName, dev } = useLabNames();
  const def = lab.cluster.vms.find((v) => v.id === vm)!;
  const restarted = lab.runtime[vm]?.restarted && !from;
  return (
    <li
      className={cn(
        'relative rounded-lg border px-2 py-1.5 text-xs transition-colors',
        from === 'down' ? 'border-bad bg-bad-soft' : from === 'migrating' ? 'border-warn bg-warn-soft' : 'border-virtual/50 bg-virtual-soft',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={vmName(vm)}>{vmName(vm)}</span>
        <span className="shrink-0 rounded bg-surface px-1 font-mono text-[10px] text-muted" title={t('ha.vm.priority', { n: def.restartPriority })}>
          P{def.restartPriority}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-muted">
        {mode === 'simple' && <span className="truncate font-mono text-[10px]">{dev(vm)}</span>}
        <span className="ml-auto shrink-0">{t('ha.vm.gb', { gb: Math.round(def.ramGb) })}</span>
      </div>
      {from === 'down' && (
        <div className="mt-1 flex items-center gap-1 font-medium text-bad">
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {t('ha.vm.down')}
        </div>
      )}
      {from === 'migrating' && (
        <div className="mt-1 flex items-center gap-1 font-medium text-warn">
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
          {t('ha.vm.migrating')}
        </div>
      )}
      {restarted && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-warn text-white" title={t('ha.vm.restarted')}>
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">{t('ha.vm.restarted')}</span>
        </span>
      )}
    </li>
  );
}

export function HostCard({ lab, host }: { lab: HaLab; host: string }) {
  const { t } = useI18n();
  const { mode } = usePrefs();
  const { dev } = useLabNames();
  const health = lab.health[host];
  const status = HOST_STATUS[health.status];
  const def = lab.cluster.hosts.find((h) => h.id === host)!;
  const vms = lab.cluster.vms
    .map((v) => v.id)
    .filter((vm) => lab.display[vm]?.from === host || (lab.runtime[vm]?.host === host && !lab.display[vm]));
  const used = lab.cluster.vms.filter((v) => lab.runtime[v.id]?.host === host).reduce((s, v) => s + v.ramGb, 0);
  const failed = lab.controls.failed.has(host);
  const inMaintenance = lab.controls.maintenance.has(host);
  const isolated = lab.controls.isolated.has(host);
  const btn = 'min-h-11 rounded-lg border border-line px-2.5 text-xs font-medium text-ink hover:bg-raised disabled:opacity-40';

  return (
    <article className={cn('flex flex-col rounded-2xl border bg-surface p-3', health.status === 'ok' ? 'border-line' : status.tone === 'text-bad' ? 'border-bad' : 'border-warn')}>
      <header className="flex items-center gap-2">
        <Server className="h-5 w-5 shrink-0 text-primary-strong" aria-hidden="true" />
        <h3 className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-ink">{dev(host)}</h3>
        <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', status.tone)}>
          <status.icon className="h-4 w-4" aria-hidden="true" />
          {t(`ha.status.${health.status}`)}
        </span>
      </header>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={cn(btn, failed && 'border-bad bg-bad-soft')} aria-pressed={failed} onClick={() => lab.toggleComponent(host)}>
          {failed ? t('ha.host.restore') : t('ha.host.fail')}
        </button>
        <button type="button" className={cn(btn, inMaintenance && 'border-warn bg-warn-soft')} aria-pressed={inMaintenance} disabled={failed} onClick={() => lab.toggleMaintenance(host)}>
          {inMaintenance ? t('ha.host.exitMaintenance') : t('ha.host.maintenance')}
        </button>
        <button type="button" className={cn(btn, isolated && 'border-warn bg-warn-soft')} aria-pressed={isolated} disabled={failed} onClick={() => lab.toggleIsolation(host)}>
          {isolated ? t('ha.host.reconnect') : t('ha.host.isolate')}
        </button>
      </div>

      <dl className="mt-3 space-y-2 text-xs">
        <div>
          <div className="flex justify-between text-muted">
            <dt>{t('ha.host.memory')}</dt>
            <dd className={cn(used > def.ramGb && 'font-semibold text-bad')}>{t('ha.host.memoryValue', { used: Math.round(used), total: def.ramGb })}</dd>
          </div>
          <Bar value={used} max={def.ramGb} />
        </div>
        {mode === 'technical' && (
          <>
            <div className="flex justify-between text-muted">
              <dt>{t('ha.host.paths')}</dt>
              <dd className={cn(health.storagePaths < health.storagePathsTotal && 'font-semibold text-warn')}>
                {t('ha.host.pathsValue', { count: health.storagePaths, total: health.storagePathsTotal })}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t('ha.host.uplinks')}</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {health.uplinks.map((u) => (
                  <ComponentToggle key={u.link} lab={lab} id={u.link} />
                ))}
              </dd>
            </div>
          </>
        )}
      </dl>

      <ul className="mt-3 grid grid-cols-2 gap-1.5">
        {vms.map((vm) => (
          <VmTile key={vm} lab={lab} vm={vm} from={lab.display[vm]?.kind} />
        ))}
      </ul>
      {vms.length === 0 && <p className="mt-3 text-xs text-muted">{t('ha.host.empty')}</p>}
    </article>
  );
}

export function OffTray({ lab }: { lab: HaLab }) {
  const { t } = useI18n();
  const { vm: vmName } = useLabNames();
  const off = lab.cluster.vms.filter((v) => !lab.runtime[v.id]?.host && !lab.display[v.id]);
  if (off.length === 0) return null;
  return (
    <div className="rounded-2xl border border-bad bg-bad-soft p-3" role="status">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <AlertTriangle className="h-4 w-4 text-bad" aria-hidden="true" />
        {t('ha.off.title')}
      </h3>
      <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {off.map((v) => (
          <li key={v.id} className="rounded-lg border border-bad bg-surface px-2 py-1.5 text-ink">
            <span className="font-semibold">{vmName(v.id)}</span>
            <span className="text-muted"> · {t('ha.off.reason', { gb: Math.round(v.ramGb) })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

