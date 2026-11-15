/**
 * The result of the simulation in four parts: what happens now, who is affected, test order,
 * fix and prevention. Simple view: parts 1 and 2 plus the workaround. Technical view: everything.
 * On top: the outcome, the active faults (removable one by one) and the ready-made scenarios.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, X, XCircle, type LucideIcon } from 'lucide-react';
import { FAULTS } from '../../data';
import { useSim } from '../../context/SimContext';
import { usePrefs } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import { faultKey, type Outcome } from '../../engine/explain';
import { siteLabel } from '../../components/map/labels';
import { cn } from '../../utils/cn';
import { useSimText } from './useSimText';

export const OUTCOME: Record<Outcome, { icon: LucideIcon; tone: string }> = {
  healthy: { icon: CheckCircle2, tone: 'border-ok bg-ok-soft text-ok' },
  absorbed: { icon: ShieldCheck, tone: 'border-ok bg-ok-soft text-ok' },
  degraded: { icon: AlertTriangle, tone: 'border-warn bg-warn-soft text-warn' },
  outage: { icon: XCircle, tone: 'border-bad bg-bad-soft text-bad' },
};

function Section({ n, title, children }: { n?: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        {n !== undefined && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-on-primary">{n}</span>}
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ResultPanel({ onScenario }: { onScenario: (site: string | undefined) => void }) {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const technical = mode === 'technical';
  const sim = useSim();
  const { text, devices, faultName } = useSimText();
  const ex = sim.explanation;
  const outcome = OUTCOME[ex.outcome];
  const broken = sim.active.length > 0;

  return (
    <div>
      {/* On phones the sheet handle already shows the outcome */}
      <div className={cn('hidden items-start gap-2.5 rounded-xl border p-3 md:flex', outcome.tone)} role="status" aria-live="polite">
        <outcome.icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">{td(`faults.outcome.${ex.outcome}`)}</p>
      </div>

      {!broken && <p className="text-sm leading-relaxed text-muted md:mt-3">{t(`sim.intro.${mode}`)}</p>}

      {broken && (
        <div className="md:mt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('sim.active')}</h3>
            <button type="button" onClick={sim.reset} className="min-h-11 rounded-lg px-2 text-sm font-medium text-primary-strong hover:bg-raised">
              {t('sim.reset')}
            </button>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {sim.active.map((f) => (
              <li key={faultKey(f)} className="flex max-w-full items-center rounded-full border border-bad/50 bg-bad-soft pl-3 text-xs font-medium text-ink">
                <span className="truncate">{faultName(f)}</span>
                <button
                  type="button"
                  onClick={() => sim.remove(faultKey(f))}
                  aria-label={t('sim.remove', { fault: faultName(f) })}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details open={!broken} className="mt-4 rounded-xl border border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-ink">{t('sim.scenarios')}</summary>
        <ul className="space-y-1 px-2 pb-2">
          {FAULTS.scenarios.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onScenario(sim.loadScenario(s.id))}
                className="flex min-h-11 w-full items-center rounded-lg px-2 text-left text-sm text-ink hover:bg-primary-soft"
              >
                {td(`faults.scenario.${s.id}`)}
              </button>
            </li>
          ))}
        </ul>
      </details>

      {broken && (
        <>
          <Section n={1} title={t('sim.section.now')}>
            <ol className="space-y-1.5 border-l-2 border-line pl-4 text-sm leading-relaxed text-ink">
              {ex.chain.map((item, i) => (
                <li key={i} className={cn(i === 0 && 'font-medium')}>
                  {text(item)}
                </li>
              ))}
            </ol>
          </Section>

          <Section n={2} title={t('sim.section.who')}>
            {ex.affected.length === 0 && <p className="text-sm text-muted">{t('sim.nobody')}</p>}
            <div className="space-y-3">
              {[...new Set(ex.affected.map((g) => g.site))].map((site) => {
                const groups = ex.affected.filter((g) => g.site === site && (technical || g.audience !== 'it'));
                const works = ex.stillWorks.find((w) => w.site === site);
                if (groups.length === 0) return null;
                return (
                  <div key={site} className="rounded-xl border border-line bg-surface p-3">
                    <h4 className="text-sm font-semibold text-ink">{siteLabel(td, site)}</h4>
                    <dl className="mt-1.5 space-y-2 text-sm">
                      {groups.map((g) => (
                        <div key={g.audience}>
                          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{td(`faults.audience.${g.audience}`)}</dt>
                          <dd>
                            <ul className="mt-0.5 space-y-0.5">
                              {g.items.map((it) => {
                                const Icon = it.state === 'down' ? XCircle : AlertTriangle;
                                return (
                                  <li key={`${it.capability}-${it.state}`} className="flex items-start gap-1.5">
                                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', it.state === 'down' ? 'text-bad' : 'text-warn')} aria-hidden="true" />
                                    <span className="text-ink">
                                      {td(`faults.cap.${it.capability}`)}
                                      <span className="text-muted">
                                        {' · '}
                                        {t(`sim.state.${it.state}`)}
                                        {technical && ` · ${devices(it.devices)}`}
                                      </span>
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {works && (
                      <p className="mt-2 flex items-start gap-1.5 border-t border-line pt-2 text-sm text-ink">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
                        <span>
                          <span className="font-medium">{t('sim.stillWorks')}: </span>
                          {works.capabilities.map((c) => td(`faults.cap.${c}`)).join(', ')}
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          {ex.warnings.length > 0 && (
            <Section title={t('sim.section.warnings')}>
              <ul className="space-y-1.5 text-sm text-ink">
                {ex.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                    {text(w)}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!technical && ex.remedies.length > 0 && (
            <Section title={t('sim.section.todo')}>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
                {[...new Set(ex.remedies.map((r) => r.workaroundKey))].map((k) => (
                  <li key={k}>{td(k)}</li>
                ))}
              </ul>
            </Section>
          )}

          {technical && ex.tests.length > 0 && (
            <Section n={3} title={t('sim.section.tests')}>
              <ol className="space-y-2 text-sm">
                {ex.tests.map((s, i) => (
                  <li key={s.id} className="flex gap-2">
                    <span className="w-5 shrink-0 text-right font-semibold text-muted">{i + 1}.</span>
                    <div className="min-w-0">
                      <span className="mr-1.5 rounded bg-raised px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{td(`faults.layer.${s.layer}`)}</span>
                      <span className="text-ink">{td(s.key)}</span>
                      {s.command && <code className="mt-1 block overflow-x-auto whitespace-pre rounded-lg bg-raised px-2 py-1 font-mono text-xs text-ink">{s.command}</code>}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {technical && ex.remedies.length > 0 && (
            <Section n={4} title={t('sim.section.fix')}>
              <div className="space-y-3">
                {ex.remedies.map((r) => (
                  <div key={faultKey(r.fault)} className="rounded-xl border border-line bg-surface p-3 text-sm">
                    <h4 className="font-semibold text-ink">{faultName(r.fault)}</h4>
                    <dl className="mt-1.5 space-y-1.5 leading-relaxed">
                      {(
                        [
                          ['workaround', r.workaroundKey],
                          ['fix', r.fixKey],
                          ['prevention', r.preventionKey],
                        ] as const
                      ).map(([label, key]) => (
                        <div key={label}>
                          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{t(`sim.${label}`)}</dt>
                          <dd className="text-ink">{td(key)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
