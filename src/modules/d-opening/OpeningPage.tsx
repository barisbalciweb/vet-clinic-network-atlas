/**
 * Module D – opening the München clinic, from signed lease to the week after go-live.
 *
 * A timeline in weeks before go-live (T−12 … +1); selecting a phase shows its checklist, who is
 * involved, typical pitfalls and one example artefact. Ticking every step up to go-live makes
 * München live on the map and in the failure simulator.
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Info, MapPinned, RotateCcw, Users } from 'lucide-react';
import { PLAYBOOK } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useOpening } from '../../context/OpeningContext';
import { useI18n } from '../../i18n/I18nContext';
import { hrefFor } from '../../hooks/useHashRoute';
import { checkKey, phaseProgress, type Phase } from '../../schema/playbook';
import { cn } from '../../utils/cn';
import { Artefact, useCatalogNames } from './artefacts';
import { ProcurementWizard } from './ProcurementWizard';
import { CATALOG } from '../../data';
import { Collapsible } from '../../components/common/Collapsible';

const FIRST = Math.min(...PLAYBOOK.phases.map((p) => p.startWeek));
const LAST = Math.max(...PLAYBOOK.phases.map((p) => p.startWeek + p.weeks - 1));
const WEEKS = Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i);

function useWeekLabel() {
  const { t } = useI18n();
  return (w: number) => (w < 0 ? t('opening.ui.weekMinus', { n: -w }) : w === 0 ? t('opening.ui.weekZero') : t('opening.ui.weekPlus', { n: w }));
}

function Timeline({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { t, td } = useI18n();
  const { done } = useOpening();
  const week = useWeekLabel();
  const cols = { gridTemplateColumns: `repeat(${WEEKS.length}, minmax(0, 1fr))` };
  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label={t('opening.ui.timeline')}>
      <div className="grid grid-cols-[7.5rem_1fr] gap-x-2 sm:grid-cols-[11rem_1fr]">
        <div />
        <div className="grid text-[10px] text-muted sm:text-xs" style={cols} aria-label={t('opening.ui.weeksAxis')}>
          {WEEKS.map((w) => (
            <span key={w} className={cn('text-center', w % 2 !== 0 && w !== 0 && 'invisible sm:visible', w === 0 && 'font-semibold text-accent-ink')}>
              {week(w)}
            </span>
          ))}
        </div>
        {PLAYBOOK.phases.map((p) => {
          const prog = phaseProgress(p, done);
          const active = p.id === selected;
          return (
            <div key={p.id} className="contents">
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                aria-pressed={active}
                aria-label={t('opening.ui.open', { phase: td(`opening.phase.${p.id}.title`) })}
                className={cn('mt-1.5 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-left text-xs font-medium sm:text-sm', active ? 'bg-primary-soft text-primary-strong' : 'text-ink hover:bg-raised')}
              >
                {prog.complete ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> : <CircleDashed className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
                <span className="line-clamp-2 hyphens-auto py-1 leading-tight">{td(`opening.phase.${p.id}.title`)}</span>
              </button>
              <div className="relative mt-1.5 grid items-center" style={cols}>
                {WEEKS.map((w) => (
                  <span key={w} className={cn('h-full border-l', w === 0 ? 'border-accent' : 'border-line/60')} aria-hidden="true" />
                ))}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => onSelect(p.id)}
                  className={cn('absolute inset-y-2 overflow-hidden rounded-md border', active ? 'border-primary' : 'border-line', prog.complete ? 'bg-primary' : 'bg-raised')}
                  style={{ left: `${((p.startWeek - FIRST) / WEEKS.length) * 100}%`, width: `${(p.weeks / WEEKS.length) * 100}%` }}
                >
                  {!prog.complete && <span className="block h-full bg-primary/50" style={{ width: `${(100 * prog.done) / prog.total}%` }} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PhaseDetail({ phase }: { phase: Phase }) {
  const { t, td } = useI18n();
  const { done, toggle, setPhase } = useOpening();
  const week = useWeekLabel();
  const prog = phaseProgress(phase, done);
  const base = `opening.phase.${phase.id}`;
  const to = phase.startWeek + phase.weeks - 1;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-ink">{td(`${base}.title`)}</h2>
            <p className="text-xs text-muted">
              {phase.weeks === 1 ? t('opening.ui.durationOne', { from: week(phase.startWeek) }) : t('opening.ui.duration', { from: week(phase.startWeek), to: week(to), n: phase.weeks })}
            </p>
          </div>
          <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', prog.complete ? 'bg-ok-soft text-ok' : 'bg-raised text-muted')}>
            {prog.complete ? t('opening.ui.completed') : t('opening.ui.progress', { done: prog.done, total: prog.total })}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink">{td(`${base}.goal`)}</p>

        <h3 className="mt-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <Users className="h-4 w-4" aria-hidden="true" />
          {t('opening.ui.people')}
        </h3>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {phase.people.map((p) => (
            <li key={p} className="rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-ink">
              {td(`opening.people.${p}`)}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('opening.ui.checklist')}</h3>
          {!prog.complete && (
            <button type="button" onClick={() => setPhase(phase.id, true)} className="min-h-11 rounded-lg px-2 text-sm font-medium text-primary-strong hover:bg-raised">
              {t('opening.ui.complete')}
            </button>
          )}
        </div>
        <ul className="mt-1 space-y-0.5">
          {phase.checklist.map((item) => {
            const checked = done.has(checkKey(phase.id, item));
            return (
              <li key={item}>
                <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg px-1 py-2 text-sm hover:bg-raised">
                  <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--c-primary)]" checked={checked} onChange={() => toggle(phase.id, item)} />
                  <span className={cn('text-ink', checked && 'text-muted line-through')}>{td(`${base}.check.${item}`)}</span>
                </label>
              </li>
            );
          })}
        </ul>

        <Collapsible className="mt-4" summary={t('opening.ui.pitfalls')}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
          {Array.from({ length: phase.pitfalls }, (_, i) => (
            <li key={i}>{td(`${base}.pitfall.${i + 1}`)}</li>
          ))}
        </ul>
        </Collapsible>
      </section>

      <Collapsible variant="card" summary={t('opening.ui.example')}>
        <Artefact phase={phase} />
      </Collapsible>
    </div>
  );
}

/** Consequence of a late order, shown on the timeline */
function LateDeliveries() {
  const { t } = useI18n();
  const { late } = useOpening();
  const { name } = useCatalogNames();
  if (late.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1" role="status">
      {late.map((l) => (
        <li key={l.sku} className="flex items-start gap-2 rounded-xl border border-warn bg-warn-soft px-3 py-2 text-sm text-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          {t('shop.ui.timelineLate', { item: name(CATALOG.items.find((i) => i.sku === l.sku)!), days: l.days })}
        </li>
      ))}
    </ul>
  );
}

export function OpeningPage() {
  const { t } = useI18n();
  const { mode } = usePrefs();
  const { done, live, reset } = useOpening();
  const [selected, setSelected] = useState(() => PLAYBOOK.phases.find((p) => !phaseProgress(p, done).complete)?.id ?? PLAYBOOK.phases[0].id);
  const phase = PLAYBOOK.phases.find((p) => p.id === selected)!;
  const totals = PLAYBOOK.phases.reduce(
    (acc, p) => {
      const pr = phaseProgress(p, done);
      return { done: acc.done + pr.done, total: acc.total + pr.total };
    },
    { done: 0, total: 0 },
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('ui.modules.opening.title')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t(`ui.modules.opening.${mode}`)}</p>
        </div>
        <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-raised">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {t('opening.ui.reset')}
        </button>
      </div>

      <div className={cn('mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border p-4', live ? 'border-ok bg-ok-soft' : 'border-line bg-surface')} role="status" aria-live="polite">
        {live ? <CheckCircle2 className="h-6 w-6 shrink-0 text-ok" aria-hidden="true" /> : <CircleDashed className="h-6 w-6 shrink-0 text-muted" aria-hidden="true" />}
        <div className="min-w-[13rem] flex-1">
          <p className="font-semibold text-ink">{live ? t('opening.ui.status.live') : t('opening.ui.status.planned')}</p>
          <p className="text-sm text-muted">{live ? t('opening.ui.statusText.live') : t('opening.ui.statusText.planned')}</p>
          <div className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-raised" aria-hidden="true">
            <div className="h-full bg-primary" style={{ width: `${(100 * totals.done) / totals.total}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">{t('opening.ui.progress', totals)}</p>
        </div>
        <a href={hrefFor('', { site: PLAYBOOK.site })} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-raised">
          <MapPinned className="h-4 w-4 text-primary-strong" aria-hidden="true" />
          {t('opening.ui.showMap')}
        </a>
      </div>

      <div className="mt-4">
        <Timeline selected={selected} onSelect={setSelected} />
      </div>
      <LateDeliveries />
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        {t('opening.ui.illustrative')}
      </p>

      <div className="mt-4">
        <PhaseDetail key={phase.id} phase={phase} />
      </div>
      {phase.artefact.type === 'procurement' && (
        <div className="mt-4">
          <ProcurementWizard />
        </div>
      )}
    </div>
  );
}
