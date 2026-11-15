/**
 * Module G – data protection (GDPR / DSGVO): where personal data is, and which measure protects it,
 * grouped by location; a day-1 checklist for a new clinic; retention placeholders.
 * The map has a data protection layer that shows the same measures on the devices.
 */
import { useState } from 'react';
import { CreditCard, Info, MapPinned, PawPrint, ShieldCheck, Siren, Users, type LucideIcon } from 'lucide-react';
import { INDEX, PRIVACY } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import { hrefFor } from '../../hooks/useHashRoute';
import type { Measure } from '../../schema/compliance';
import { cn } from '../../utils/cn';

export const CATEGORY_ICON: Record<string, LucideIcon> = { owner: PawPrint, staff: Users, payment: CreditCard };

export function CategoryIcons({ categories, className }: { categories: string[]; className?: string }) {
  const { td } = useI18n();
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {categories.map((c) => {
        const Icon = CATEGORY_ICON[c] ?? ShieldCheck;
        return (
          <span key={c} title={td(`privacy.category.${c}`)} className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
            <Icon className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{td(`privacy.category.${c}`)}</span>
          </span>
        );
      })}
    </span>
  );
}

/** The site to open on the map for a measure: a clinic device of one of its roles, else any */
function siteFor(m: Measure): string | undefined {
  const devices = INDEX.topology.devices.filter((d) => m.roles?.includes(d.role));
  return (devices.find((d) => d.site === 'hh') ?? devices[0])?.site;
}

function MeasureItem({ m }: { m: Measure }) {
  const { t, td } = useI18n();
  const site = siteFor(m);
  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">{td(`privacy.measure.${m.id}.title`)}</h4>
        <CategoryIcons categories={m.categories} className="shrink-0" />
      </div>
      <p className="mt-1 text-sm leading-relaxed text-muted">{td(`privacy.measure.${m.id}.example`)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-raised px-2 py-0.5 text-muted">{td(`privacy.activity.${m.activity}`)}</span>
        {site && (
          <a href={hrefFor('', { site, privacy: '1' })} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary-strong underline-offset-2 hover:underline">
            <MapPinned className="h-3.5 w-3.5" aria-hidden="true" />
            {t('privacy.ui.onMap')}
          </a>
        )}
      </div>
    </li>
  );
}

export function PrivacyPage() {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('ui.modules.privacy.title')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t(`ui.modules.privacy.${mode}`)}</p>
        </div>
        <a href={hrefFor('', { site: 'hh', privacy: '1' })} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-on-primary hover:bg-primary-strong">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          {t('privacy.ui.showMap')}
        </a>
      </div>
      <p className="mt-3 flex items-start gap-2 rounded-xl border border-accent bg-accent-soft px-3 py-2 text-sm text-ink">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden="true" />
        {t('privacy.ui.disclaimer')}
      </p>

      <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-base font-semibold text-ink">{t('privacy.ui.categoriesTitle')}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {PRIVACY.categories.map((c) => {
            const Icon = CATEGORY_ICON[c] ?? ShieldCheck;
            return (
              <li key={c} className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1.5 text-sm font-medium text-primary-strong">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {td(`privacy.category.${c}`)}
              </li>
            );
          })}
        </ul>
      </section>

      <h2 className="mt-6 text-base font-semibold text-ink">{t('privacy.ui.measuresTitle')}</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {PRIVACY.locations.map((loc) => (
          <section key={loc} className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-primary-strong">{td(`privacy.location.${loc}`)}</h3>
            {loc === 'organization' && (
              <p className="mt-2 flex items-start gap-2 rounded-xl bg-bad-soft p-2.5 text-sm font-medium text-ink">
                <Siren className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden="true" />
                {t('privacy.ui.incident')}
              </p>
            )}
            <ul className="mt-3 space-y-2">
              {PRIVACY.measures
                .filter((m) => m.location === loc)
                .map((m) => (
                  <MeasureItem key={m.id} m={m} />
                ))}
            </ul>
          </section>
        ))}

        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-primary-strong">{t('privacy.ui.day1Title')}</h3>
          <ul className="mt-2 space-y-0.5">
            {PRIVACY.day1.map((d) => {
              const checked = done.has(d);
              return (
                <li key={d}>
                  <label className="flex min-h-11 items-start gap-2.5 rounded-lg px-1 py-2 text-sm hover:bg-raised">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--c-primary)]"
                      checked={checked}
                      onChange={() =>
                        setDone((cur) => {
                          const next = new Set(cur);
                          if (!next.delete(d)) next.add(d);
                          return next;
                        })
                      }
                    />
                    <span className={cn('text-ink', checked && 'text-muted line-through')}>{td(`privacy.day1.${d}`)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted">{t('privacy.ui.day1Link')}</p>
          <a href={hrefFor('opening')} className="inline-flex min-h-11 items-center text-sm font-medium text-primary-strong underline-offset-2 hover:underline">
            {t('privacy.ui.openPlaybook')}
          </a>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-primary-strong">{t('privacy.ui.retentionTitle')}</h3>
          <dl className="mt-2 divide-y divide-line text-sm">
            {PRIVACY.retention.map((r) => (
              <div key={r} className="flex flex-wrap justify-between gap-x-3 py-2">
                <dt className="text-ink">{td(`privacy.retention.${r}`)}</dt>
                <dd className="text-xs italic text-muted">{t('privacy.ui.placeholder')}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
