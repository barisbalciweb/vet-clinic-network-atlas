/**
 * Module C – common issues: a searchable catalogue of everyday tickets.
 * Each card: the symptom as the user says it, likely causes (most likely first), checks in order
 * (technical view), the solution, and buttons into the map and the failure simulator.
 * Requests (on- and offboarding) show pitfalls and steps instead of causes and checks.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, MapPinned, Search, Siren, X, Zap } from 'lucide-react';
import { ISSUES } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import { hrefFor } from '../../hooks/useHashRoute';
import { issueKeys, type IssueItem } from '../../schema/issues';
import { cn } from '../../utils/cn';
import { Collapsible } from '../../components/common/Collapsible';

const fold = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function IssueCard({ item }: { item: IssueItem }) {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const base = `issues.item.${item.id}`;
  const request = item.kind === 'request';
  const list = (part: 'causes' | 'checks', count: number) => Array.from({ length: count }, (_, i) => td(`${base}.${part}.${i + 1}`));
  // Steps of a request are the process itself, so they show in both views
  const showChecks = mode === 'technical' || request;

  return (
    <article className="flex flex-col rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-primary-strong">{td(`issues.category.${item.category}`)}</span>
        <span className={cn('rounded-full px-2 py-0.5', request ? 'bg-accent-soft text-accent-ink' : 'bg-raised text-muted')}>{t(`issues.ui.kind.${item.kind}`)}</span>
        {item.critical && (
          <span className="inline-flex items-center gap-1 rounded-full bg-bad-soft px-2 py-0.5 text-bad">
            <Siren className="h-3 w-3" aria-hidden="true" />
            {t('issues.ui.critical')}
          </span>
        )}
      </div>
      <h2 className="mt-2 text-base font-semibold leading-snug text-ink">{td(`${base}.symptom`)}</h2>

      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{t('issues.ui.solution')}</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink">{td(`${base}.solution`)}</p>

      {item.warning && (
        <div className="mt-3 flex gap-2 rounded-xl border border-warn/60 bg-warn-soft p-3 text-sm text-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <p>
            <strong className="font-semibold">{t('issues.ui.warning')}: </strong>
            {td(`${base}.warning`)}
          </p>
        </div>
      )}

      <Collapsible className="mt-3" summary={request ? t('issues.ui.moreRequest') : showChecks ? t('issues.ui.more') : t('issues.ui.causesShort')}>
      <h3 className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">{request ? t('issues.ui.pitfalls') : t('issues.ui.causes')}</h3>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-ink">
        {list('causes', item.causes).map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>

      {showChecks && (
        <>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{request ? t('issues.ui.steps') : t('issues.ui.checks')}</h3>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-ink">
            {list('checks', item.checks).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </>
      )}

      </Collapsible>

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <a
          href={hrefFor('', { site: item.show.site, issue: item.id })}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink hover:bg-raised"
        >
          <MapPinned className="h-4 w-4 text-primary-strong" aria-hidden="true" />
          {t('issues.ui.showOnMap')}
        </a>
        {item.simulate && (
          <a
            href={hrefFor('simulator', { issue: item.id })}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink hover:border-bad hover:bg-bad-soft"
          >
            <Zap className="h-4 w-4 text-bad" aria-hidden="true" />
            {t('issues.ui.simulate')}
          </a>
        )}
      </div>
    </article>
  );
}

export function IssuesPage() {
  const { t, td, lang } = useI18n();
  const { mode } = usePrefs();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  // One searchable text per issue, in the current language
  const texts = useMemo(
    () => new Map(ISSUES.issues.map((it) => [it.id, fold([...issueKeys(it), `issues.category.${it.category}`].map((k) => td(k)).join(' '))])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang],
  );
  const words = fold(query).split(/\s+/).filter(Boolean);
  const shown = ISSUES.issues.filter((it) => (!category || it.category === category) && words.every((w) => texts.get(it.id)!.includes(w)));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('ui.modules.issues.title')}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{t(`ui.modules.issues.${mode}`)}</p>

      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            aria-label={t('issues.ui.search')}
            placeholder={t('issues.ui.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-10 text-sm text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label={t('issues.ui.clear')}
              onClick={() => setQuery('')}
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div role="group" aria-label={t('issues.ui.filter')} className="flex flex-wrap gap-1.5">
          {[null, ...ISSUES.categories].map((c) => (
            <button
              key={c ?? 'all'}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn(
                'min-h-11 rounded-full border px-3 text-sm font-medium',
                category === c ? 'border-primary bg-primary-soft text-primary-strong' : 'border-line bg-surface text-ink hover:bg-raised',
              )}
            >
              {c ? td(`issues.category.${c}`) : t('issues.ui.all')}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-muted" aria-live="polite">
        {shown.length === 0 ? t('issues.ui.none') : t('issues.ui.count', { count: shown.length })}
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((it) => (
          <IssueCard key={it.id} item={it} />
        ))}
      </div>
    </div>
  );
}
