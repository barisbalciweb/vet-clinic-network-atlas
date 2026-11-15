/**
 * Module E – standardization and automation: why one kit, one template, a fleet dashboard,
 * a staged firmware rollout, an Ansible run, macOS zero-touch, and what it saves.
 *
 * The dashboard and the Ansible run read the live simulation: a clinic that is offline in the
 * failure simulator is offline here too, and a switch that is off there is unreachable here.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Laptop, Loader2, Play, RotateCcw, XCircle } from 'lucide-react';
import { CATALOG, INDEX, PLAYBOOK, STANDARDS, TOPOLOGY } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useSim } from '../../context/SimContext';
import { useOpening } from '../../context/OpeningContext';
import { useI18n } from '../../i18n/I18nContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ANSIBLE_INVENTORY, ANSIBLE_PLAYBOOK, ansibleOutput, ansibleRun, diffLines, siteConfig, type AnsibleOutcome } from '../../schema/standards';
import { Segmented } from '../../components/common/Segmented';
import { siteLabel } from '../../components/map/labels';
import { useCatalogNames } from '../d-opening/artefacts';
import { cn } from '../../utils/cn';

const CLINICS = TOPOLOGY.sites.filter((s) => s.kind === 'clinic').map((s) => s.id);

function Card({ title, children, badge }: { title: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {badge}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function KitCard() {
  const { t, td } = useI18n();
  const { name } = useCatalogNames();
  const items = CATALOG.items.filter((i) => i.standard && i.category && !i.licence);
  return (
    <Card title={t('std.ui.kitTitle')}>
      <p className="text-sm text-muted">{t('std.ui.kitIntro')}</p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <ul className="divide-y divide-line rounded-xl border border-line text-sm">
          {items.map((i) => (
            <li key={i.sku} className="flex justify-between gap-3 px-3 py-1.5">
              <span className="text-ink">{name(i)}</span>
              <span className="font-mono text-xs text-muted">{i.model}</span>
            </li>
          ))}
        </ul>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('std.ui.reasonsTitle')}</h3>
          <ul className="mt-2 space-y-2 text-sm text-ink">
            {STANDARDS.kitReasons.map((r) => (
              <li key={r} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary-strong" aria-hidden="true" />
                {td(`std.kit.reason.${r}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function TemplateCard() {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const [a, setA] = useState('hh');
  const [b, setB] = useState('muc');
  const left = useMemo(() => siteConfig(TOPOLOGY, a, STANDARDS, PLAYBOOK.dhcpPool), [a]);
  const right = useMemo(() => siteConfig(TOPOLOGY, b, STANDARDS, PLAYBOOK.dhcpPool), [b]);
  const diff = diffLines(left, right);
  const select = (value: string, set: (v: string) => void, label: string) => (
    <label className="text-sm text-ink">
      <span className="mr-2 text-muted">{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)} className="h-11 rounded-xl border border-line bg-surface px-3 text-ink">
        {CLINICS.map((c) => (
          <option key={c} value={c}>
            {siteLabel(td, c)}
          </option>
        ))}
      </select>
    </label>
  );
  const Block = ({ lines, site }: { lines: string[]; site: string }) => (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-semibold text-muted">{siteLabel(td, site)}</div>
      <pre className="overflow-x-auto rounded-xl bg-raised p-2 font-mono text-[11px] leading-5 text-ink">
        {lines.map((l, i) => (
          <div key={i} className={cn('whitespace-pre px-1', diff.has(i) && 'rounded bg-accent-soft font-semibold text-accent-ink')}>
            {diff.has(i) && <span className="sr-only">{t('std.ui.differs')}: </span>}
            {l}
          </div>
        ))}
      </pre>
    </div>
  );

  return (
    <Card title={t('std.ui.templateTitle')}>
      <p className="text-sm text-muted">{t(`std.ui.templateIntro.${mode}`)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t('std.ui.variables')}</span>
        {['site', 'code', 'n'].map((v) => (
          <code key={v} className="rounded-lg bg-accent-soft px-2 py-1 font-mono text-xs text-accent-ink">{`{${v}}`}</code>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        {select(a, setA, t('std.ui.compareA'))}
        {select(b, setB, t('std.ui.compareB'))}
      </div>
      <p className="mt-3 text-sm font-medium text-ink">{t('std.ui.diffSummary', { count: diff.size, total: left.length })}</p>
      {mode === 'technical' ? (
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          <Block lines={left} site={a} />
          <Block lines={right} site={b} />
        </div>
      ) : (
        <ul className="mt-2 space-y-1 font-mono text-[11px] text-ink">
          {[...diff].slice(0, 4).map((i) => (
            <li key={i} className="overflow-x-auto rounded-lg bg-raised p-2">
              <div className="whitespace-pre text-muted">− {left[i]}</div>
              <div className="whitespace-pre text-accent-ink">+ {right[i]}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Versions = Record<string, string>;

function DashboardCard() {
  const { t, td } = useI18n();
  const sim = useSim();
  const { live } = useOpening();
  const [applied, setApplied] = useState(false);
  const [versions, setVersions] = useState<Versions>(() => Object.fromEntries(CLINICS.map((c) => [c, STANDARDS.firmware.current])));
  const [updating, setUpdating] = useState<string[]>([]);
  const [stage, setStage] = useState(0);
  const [rolledBack, setRolledBack] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const inDashboard = (site: string) => site !== PLAYBOOK.site || applied || live;
  const { current, target } = STANDARDS.firmware;

  const runStage = (i: number) => {
    const sites = STANDARDS.rollout[i].sites.filter(inDashboard);
    setRolledBack(false);
    setUpdating(sites);
    timer.current = window.setTimeout(() => {
      setVersions((v) => ({ ...v, ...Object.fromEntries(sites.map((s) => [s, target])) }));
      setUpdating([]);
      setStage(i + 1);
    }, 1500);
  };
  const rollback = () => {
    setVersions(Object.fromEntries(CLINICS.map((c) => [c, current])));
    setStage(0);
    setRolledBack(true);
  };

  const clients = (site: string) =>
    INDEX.devicesOfSite(site).filter((d) => INDEX.roles.get(d.role)?.layer === 'endpoint' && sim.result.devices[d.id]?.on && sim.result.devices[d.id]?.state !== 'down').length;

  const status = (q: 'primary' | 'backup' | 'offline' | 'down' | undefined, kind: 'wan' | 'vpn') => {
    if (!q) return <span className="text-muted">–</span>;
    const good = q === 'primary';
    const bad = q === 'offline' || q === 'down';
    const Icon = good ? CheckCircle2 : bad ? XCircle : AlertTriangle;
    return (
      <span className="inline-flex items-center gap-1">
        <Icon className={cn('h-4 w-4', good ? 'text-ok' : bad ? 'text-bad' : 'text-warn')} aria-hidden="true" />
        {t(`std.ui.${kind}.${q}` as 'std.ui.wan.primary')}
      </span>
    );
  };

  return (
    <Card title={t('std.ui.dashTitle')} badge={<span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-ink">{t('std.ui.simulation')}</span>}>
      <p className="text-sm text-muted">{t('std.ui.dashIntro')}</p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              {(['site', 'wan', 'vpn', 'clients', 'firmware'] as const).map((c) => (
                <th key={c} className="px-3 py-2 font-semibold">
                  {t(`std.ui.col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-ink">
            {CLINICS.map((c) => {
              if (!inDashboard(c))
                return (
                  <tr key={c}>
                    <td className="px-3 py-2 font-medium">{siteLabel(td, c)}</td>
                    <td colSpan={4} className="px-3 py-2">
                      <span className="mr-3 text-muted">{t('std.ui.notApplied')}</span>
                      <button type="button" onClick={() => setApplied(true)} className="min-h-11 rounded-lg border border-primary px-3 text-sm font-medium text-primary-strong hover:bg-primary-soft">
                        {t('std.ui.apply')}
                      </button>
                    </td>
                  </tr>
                );
              const s = sim.result.sites[c];
              const waiting = c === PLAYBOOK.site && !live;
              return (
                <tr key={c}>
                  <td className="px-3 py-2 font-medium">{siteLabel(td, c)}</td>
                  <td className="px-3 py-2">{waiting ? <span className="text-muted">{t('std.ui.waiting')}</span> : status(s?.wan, 'wan')}</td>
                  <td className="px-3 py-2">{waiting ? <span className="text-muted">–</span> : status(s?.vpn, 'vpn')}</td>
                  <td className="px-3 py-2">{waiting ? '–' : clients(c)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {updating.includes(c) ? (
                      <span className="inline-flex items-center gap-1 font-sans text-warn">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {t('std.ui.updating')}
                      </span>
                    ) : (
                      <span className={cn(versions[c] === target && 'font-semibold text-ok')}>{versions[c]}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {applied && !live && <p className="mt-2 text-sm text-ink">{t('std.ui.applied')}</p>}

      <h3 className="mt-4 text-sm font-semibold text-ink">{t('std.ui.firmwareTitle', { from: current, to: target })}</h3>
      <ol className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {STANDARDS.rollout.map((r, i) => (
          <li key={r.id} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="h-4 w-4 text-muted" aria-hidden="true" />}
            <span className={cn('rounded-full px-2.5 py-1', stage > i ? 'bg-ok-soft text-ok' : stage === i ? 'bg-primary-soft text-primary-strong' : 'bg-raised text-muted')}>
              {td(`std.dash.stage.${r.id}`)}: {r.sites.filter(inDashboard).map((s) => siteLabel(td, s)).join(', ')}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
        {stage < STANDARDS.rollout.length && (
          <button type="button" disabled={updating.length > 0} onClick={() => runStage(stage)} className="min-h-11 rounded-xl bg-primary px-3 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-50">
            {t('std.ui.start', { stage: td(`std.dash.stage.${STANDARDS.rollout[stage].id}`) })}
          </button>
        )}
        {stage > 0 && stage < STANDARDS.rollout.length && (
          <button type="button" disabled={updating.length > 0} onClick={rollback} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink hover:bg-raised">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('std.ui.rollback')}
          </button>
        )}
        {stage === 1 && <p className="text-sm text-ink">{t('std.ui.observe', { hours: STANDARDS.firmware.observeHours })}</p>}
        {stage === STANDARDS.rollout.length && <p className="text-sm font-medium text-ok">{t('std.ui.done', { version: target })}</p>}
        {rolledBack && <p className="text-sm text-ink">{t('std.ui.rolledBack', { version: current })}</p>}
      </div>
    </Card>
  );
}

const OUTCOME_TONE: Record<AnsibleOutcome, string> = {
  ok: 'bg-ok-soft text-ok',
  changed: 'bg-warn-soft text-warn',
  failed: 'bg-bad-soft text-bad',
  unreachable: 'bg-bad-soft text-bad',
};

function AnsibleCard() {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const sim = useSim();
  const { siteStatus } = useOpening();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [tab, setTab] = useState<'inventory' | 'playbook'>('playbook');
  const [shown, setShown] = useState(0);
  const [running, setRunning] = useState(false);
  const name = (id: string) => INDEX.devices.get(id)?.name ?? id;

  const hosts = useMemo(
    () => ansibleRun(STANDARDS, INDEX, (s) => siteStatus(s) === 'live', (d) => !!sim.result.devices[d]?.on && sim.result.sites[INDEX.devices.get(d)!.site]?.vpn !== 'down'),
    [sim.result, siteStatus],
  );
  const output = useMemo(() => ansibleOutput(hosts, name), [hosts]);
  const done = shown >= output.length && output.length > 0;

  useEffect(() => {
    if (!running) return;
    if (shown >= output.length) {
      setRunning(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(reducedMotion ? output.length : shown + 1), 45);
    return () => window.clearTimeout(timer);
  }, [running, shown, output.length, reducedMotion]);

  return (
    <Card title={t('std.ui.ansibleTitle')}>
      <p className="text-sm text-muted">{t('std.ui.ansibleIntro')}</p>
      {mode === 'technical' && (
        <div className="mt-3">
          <Segmented<'inventory' | 'playbook'>
            label={t('std.ui.ansibleTitle')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'playbook', label: t('std.ui.playbook') },
              { value: 'inventory', label: t('std.ui.inventory') },
            ]}
          />
          <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-raised p-3 font-mono text-[11px] leading-5 text-ink">{tab === 'playbook' ? ANSIBLE_PLAYBOOK : ANSIBLE_INVENTORY}</pre>
        </div>
      )}
      <button
        type="button"
        disabled={running}
        onClick={() => {
          setShown(0);
          setRunning(true);
        }}
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-50"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        {running ? t('std.ui.running') : t('std.ui.run')}
      </button>
      {mode === 'technical' && shown > 0 && (
        <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-[#1d2321] p-3 font-mono text-[11px] leading-5 text-[#d7e2df]" aria-label={t('std.ui.output')}>
          {output.slice(0, shown).map((l, i) => (
            <div key={i} className={cn(l.startsWith('changed') && 'text-[#f0c27a]', (l.startsWith('fatal') || l.includes('failed=1') || l.includes('unreachable=1')) && 'text-[#f59a8f]', l.startsWith('ok:') && 'text-[#8fd19e]')}>
              {l || ' '}
            </div>
          ))}
        </pre>
      )}
      {done && (
        <div className="mt-3 space-y-2" aria-live="polite">
          <ul className="flex flex-wrap gap-1.5">
            {hosts.map((h) => (
              <li key={h.device} className={cn('rounded-full px-2.5 py-1 font-mono text-xs font-semibold', OUTCOME_TONE[h.outcome])}>
                {name(h.device)}: {t(`std.ui.outcome.${h.outcome}`)}
              </li>
            ))}
          </ul>
          {hosts
            .filter((h) => h.outcome === 'failed' || h.outcome === 'unreachable')
            .map((h) => (
              <div key={h.device} className="rounded-xl border border-bad bg-bad-soft p-3 text-sm text-ink">
                {h.outcome === 'failed' ? (
                  <>
                    <p className="font-medium">{td(`std.ansible.failure.${STANDARDS.ansible.failure}.reason`, { host: name(h.device) })}</p>
                    <p className="mt-1 text-muted">{td(`std.ansible.failure.${STANDARDS.ansible.failure}.fix`, { host: name(h.device) })}</p>
                  </>
                ) : (
                  <p>{t('std.ui.unreachable', { host: name(h.device) })}</p>
                )}
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}

function ZeroTouchCard() {
  const { t, td } = useI18n();
  return (
    <Card title={t('std.ui.zeroTitle')}>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {STANDARDS.zeroTouch.map((s, i) => (
          <li key={s} className="relative rounded-xl border border-line bg-raised/50 p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-on-primary">{i + 1}</span>
              <span className="text-sm font-semibold text-ink">{td(`std.zero.${s}.title`)}</span>
              {i === STANDARDS.zeroTouch.length - 1 && <Laptop className="ml-auto h-4 w-4 text-primary-strong" aria-hidden="true" />}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{td(`std.zero.${s}.text`)}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function CompareCard() {
  const { t, td } = useI18n();
  return (
    <Card title={t('std.ui.compareTitle')}>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded bg-muted/50" aria-hidden="true" />
          {t('std.ui.without')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded bg-primary" aria-hidden="true" />
          {t('std.ui.with')}
        </span>
      </div>
      <dl className="space-y-3">
        {STANDARDS.comparison.map((c) => {
          const max = Math.max(c.without, c.with);
          return (
            <div key={c.id}>
              <dt className="text-sm text-ink">{td(`std.compare.${c.id}`)}</dt>
              <dd className="mt-1 space-y-1">
                {(
                  [
                    ['without', c.without, 'bg-muted/50'],
                    ['with', c.with, 'bg-primary'],
                  ] as const
                ).map(([k, v, tone]) => (
                  <div key={k} className="flex items-center gap-2">
                    <div className="h-4 flex-1 overflow-hidden rounded bg-raised">
                      <div className={cn('h-full rounded', tone)} style={{ width: `${(100 * v) / max}%` }} />
                    </div>
                    <span className="w-40 shrink-0 text-xs text-muted">
                      {t(`std.ui.${k}`)}: <span className="font-semibold text-ink">{v}</span>
                    </span>
                  </div>
                ))}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-xs text-muted">{t('std.ui.illustrative')}</p>
    </Card>
  );
}

export function StandardsPage() {
  const { t } = useI18n();
  const { mode } = usePrefs();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('ui.modules.standards.title')}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{t(`ui.modules.standards.${mode}`)}</p>
      <div className="mt-5 space-y-4">
        <KitCard />
        <TemplateCard />
        <DashboardCard />
        <AnsibleCard />
        <ZeroTouchCard />
        <CompareCard />
      </div>
    </div>
  );
}
