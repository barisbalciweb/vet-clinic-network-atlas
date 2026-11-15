/**
 * Module H – monitoring, on-call and working with engineering.
 * The status board is computed from the failure simulator: break something there and it shows here.
 */
import { useMemo, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Gauge, XCircle, Zap, type LucideIcon } from 'lucide-react';
import { INDEX, MONITORING } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useSim } from '../../context/SimContext';
import { useOpening } from '../../context/OpeningContext';
import { useI18n } from '../../i18n/I18nContext';
import { hrefFor } from '../../hooks/useHashRoute';
import { statusBoard, type Health } from '../../schema/compliance';
import { serviceLabel, siteLabel } from '../../components/map/labels';
import { cn } from '../../utils/cn';
import { useSimText } from '../b-simulator/useSimText';
import { Collapsible } from '../../components/common/Collapsible';

const HEALTH: Record<Health, { icon: LucideIcon; tone: string }> = {
  ok: { icon: CheckCircle2, tone: 'text-ok' },
  warn: { icon: AlertTriangle, tone: 'text-warn' },
  bad: { icon: XCircle, tone: 'text-bad' },
};

function Cell({ health, children }: { health: Health; children: ReactNode }) {
  const { t } = useI18n();
  const h = HEALTH[health];
  return (
    <span className="inline-flex items-center gap-1.5">
      <h.icon className={cn('h-4 w-4 shrink-0', h.tone)} aria-hidden="true" />
      <span className="sr-only">{t(`mon.ui.health.${health}`)}: </span>
      {children}
    </span>
  );
}

function Card({ title, children, intro }: { title: string; children: ReactNode; intro?: string }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function StatusBoardCard() {
  const { t, td } = useI18n();
  const sim = useSim();
  const { siteStatus } = useOpening();
  const live = INDEX.topology.sites.filter((s) => s.kind !== 'external' && siteStatus(s.id) === 'live').map((s) => s.id);
  const board = useMemo(() => statusBoard(sim.result, INDEX, MONITORING, live, sim.active), [sim.result, sim.active, live.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = board.alerts.filter((a) => a.health === 'bad').length;
  const warn = board.alerts.length - bad;
  // Hostname in the technical view, what the device is (and where) in the simple view
  const { device: name } = useSimText();
  const param = (k: string, v: string | number) => (k === 'site' ? siteLabel(td, String(v)) : k === 'device' ? name(String(v)) : k === 'service' ? serviceLabel(td, String(v)) : v);
  const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted';

  return (
    <Card title={t('mon.ui.boardTitle')} intro={t('mon.ui.boardIntro')}>
      <div className={cn('flex flex-wrap items-center gap-3 rounded-xl p-3', bad ? 'bg-bad-soft' : warn ? 'bg-warn-soft' : 'bg-ok-soft')} role="status" aria-live="polite">
        <Gauge className={cn('h-5 w-5', bad ? 'text-bad' : warn ? 'text-warn' : 'text-ok')} aria-hidden="true" />
        <span className="font-medium text-ink">{board.alerts.length ? t('mon.ui.alerts', { bad, warn }) : t('mon.ui.allGood')}</span>
        <a href={hrefFor('simulator')} className="ml-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary-strong underline-offset-2 hover:underline">
          <Zap className="h-4 w-4" aria-hidden="true" />
          {t('mon.ui.openSim')}
        </a>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line">
              {(['site', 'wan', 'vpn', 'wifi', 'key'] as const).map((c) => (
                <th key={c} className={th}>
                  {t(`mon.ui.col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-ink">
            {board.sites.map((s) => (
              <tr key={s.site}>
                <td className="px-3 py-2 font-medium">
                  <Cell health={s.health}>{siteLabel(td, s.site)}</Cell>
                </td>
                <td className="px-3 py-2">
                  <Cell health={s.wan.health}>{t(`mon.ui.wan.${s.wan.value}`)}</Cell>
                </td>
                <td className="px-3 py-2">{s.vpn ? <Cell health={s.vpn.health}>{t(`mon.ui.vpn.${s.vpn.value}`)}</Cell> : <span className="text-muted">–</span>}</td>
                <td className="px-3 py-2">
                  <Cell health={s.wifi.health}>{t('mon.ui.wifiValue', { up: s.wifi.up, total: s.wifi.total })}</Cell>
                </td>
                <td className="px-3 py-2">
                  <Cell health={s.key.health}>
                    {s.key.down.length ? t('mon.ui.keyDown', { count: s.key.down.length }) : s.key.degraded.length ? t('mon.ui.keyDegraded', { count: s.key.degraded.length }) : t('mon.ui.keyOk')}
                  </Cell>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-4 text-sm font-semibold text-ink">{t('mon.ui.hqTitle')}</h3>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t('mon.ui.hosts'), board.hq.hosts.health, t('mon.ui.hostsValue', { up: board.hq.hosts.up, total: board.hq.hosts.total })],
          [t('mon.ui.vms'), board.hq.vms.health, t('mon.ui.vmsValue', { running: board.hq.vms.running, total: board.hq.vms.total })],
          [t('mon.ui.storage'), board.hq.storage.health, t('mon.ui.hostsValue', { up: board.hq.storage.up, total: board.hq.storage.total })],
          [t('mon.ui.backup'), board.hq.backup, board.hq.backup === 'ok' ? t('mon.ui.backupOk') : t('mon.ui.backupBad')],
        ].map(([label, health, value]) => (
          <div key={label as string} className="rounded-xl border border-line p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
            <dd className="mt-1 text-ink">
              <Cell health={health as Health}>{value}</Cell>
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 rounded-xl border border-line p-3 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{t('mon.ui.certs')}</div>
        <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
          {board.hq.certs.map((c) => (
            <li key={c.id}>
              <Cell health={c.health}>
                {serviceLabel(td, c.service)}: {c.expired ? t('mon.ui.certExpired') : t('mon.ui.certDays', { days: c.daysLeft })}
              </Cell>
            </li>
          ))}
        </ul>
      </div>

      {board.alerts.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold text-ink">{t('mon.ui.alertsTitle')}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {board.alerts.map((a, i) => (
              <li key={i}>
                <Cell health={a.health}>{td(a.key, Object.fromEntries(Object.entries(a.params).map(([k, v]) => [k, param(k, v)])))}</Cell>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export function MonitoringPage() {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const { device: name } = useSimText();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('ui.modules.monitoring.title')}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{t(`ui.modules.monitoring.${mode}`)}</p>
      <div className="mt-5 space-y-4">
        <StatusBoardCard />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('mon.ui.oncallTitle')} intro={t('mon.ui.oncallIntro')}>
            <ol className="space-y-3 border-l-2 border-line pl-4">
              {MONITORING.onCall.steps.map((s) => (
                <li key={s.id} className="relative">
                  <span className="absolute -left-[1.4rem] top-1 h-3 w-3 rounded-full border-2 border-surface bg-primary" aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-xs text-muted">{s.time}</span>
                    <span className="text-sm font-semibold text-ink">{td(`mon.oncall.${s.id}.title`)}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-ink">{td(`mon.oncall.${s.id}.text`)}</p>
                </li>
              ))}
            </ol>
            <a
              href={hrefFor('simulator', { scenario: MONITORING.onCall.scenario })}
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink hover:border-bad hover:bg-bad-soft"
            >
              <Zap className="h-4 w-4 text-bad" aria-hidden="true" />
              {t('mon.ui.simulate')}
            </a>
          </Card>

          <Card title={t('mon.ui.warningsTitle')} intro={t('mon.ui.warningsIntro')}>
            <ul className="space-y-2">
              {MONITORING.earlyWarnings.map((w) => (
                <li key={w.id} className="flex items-start gap-2 rounded-xl border border-warn/50 bg-warn-soft/50 p-3 text-sm text-ink">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                  {td(`mon.warn.${w.id}`, { device: name(w.device), value: w.value, limit: w.limit })}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card title={t('mon.ui.releaseTitle')} intro={t('mon.ui.releaseIntro')}>
          <ol className="grid gap-2 md:grid-cols-4">
            {MONITORING.release.steps.map((s, i) => (
              <li key={s} className="relative rounded-xl border border-line bg-raised/50 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-on-primary">{i + 1}</span>
                  <span className="text-sm font-semibold text-ink">{td(`mon.release.step.${s}.title`)}</span>
                  {i < MONITORING.release.steps.length - 1 && <ArrowRight className="ml-auto hidden h-4 w-4 text-muted md:block" aria-hidden="true" />}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{td(`mon.release.step.${s}.text`)}</p>
              </li>
            ))}
          </ol>
          <Collapsible className="mt-4" summary={t('mon.ui.checksTitle')}>
          <ul className="space-y-1.5 text-sm text-ink">
            {MONITORING.release.checks.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary-strong" aria-hidden="true" />
                {td(`mon.release.check.${c}`)}
              </li>
            ))}
          </ul>
          </Collapsible>
        </Card>
        <p className="text-xs text-muted">{t('mon.ui.illustrative')}</p>
      </div>
    </div>
  );
}
