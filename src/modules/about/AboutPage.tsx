/** "About this project": what the app demonstrates, that everything is fictional, the stack, the repo. */
import type { ReactNode } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { AUTHOR_NAME, REPO_URL, TECH_STACK } from '../../config';
import { useT } from '../../i18n/I18nContext';
import { usePrefs } from '../../context/PrefsContext';
import { hrefFor } from '../../hooks/useHashRoute';
import { MODULES } from '../registry';

const TRY = [
  { id: 'switch', href: hrefFor('simulator', { scenario: 'monday-switch' }) },
  { id: 'host', href: hrefFor('ha-lab') },
  { id: 'opening', href: hrefFor('opening') },
] as const;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-strong">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-ink">{children}</div>
    </section>
  );
}

export function AboutPage() {
  const t = useT();
  const { mode } = usePrefs();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('ui.about.title')}</h1>
      <div className="mt-6 grid gap-4">
        <Card title={t('ui.about.whatTitle')}>{t('ui.about.what')}</Card>
        <Card title={t('ui.about.tryTitle')}>
          <ul className="space-y-1">
            {TRY.map((x) => (
              <li key={x.id}>
                <a href={x.href} className="flex min-h-11 items-center gap-2 rounded-lg px-2 -mx-2 hover:bg-raised">
                  <ArrowRight className="h-4 w-4 shrink-0 text-primary-strong" aria-hidden="true" />
                  {t(`ui.about.try.${x.id}`)}
                </a>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('ui.about.modulesTitle')}>
          <ul className="grid gap-1 sm:grid-cols-2">
            {MODULES.map((m) => (
              <li key={m.id}>
                <a href={hrefFor(m.path)} className="-mx-2 flex min-h-11 items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-raised">
                  <m.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-strong" aria-hidden="true" />
                  <span>
                    <span className="block font-medium">
                      {m.letter} · {t(`ui.modules.${m.id}.title`)}
                    </span>
                    <span className="block text-xs text-muted">{t(`ui.modules.${m.id}.${mode}`)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('ui.about.fictionalTitle')}>{t('ui.about.fictional')}</Card>
        <Card title={t('ui.about.howTitle')}>{t('ui.about.how')}</Card>
        <Card title={t('ui.about.stackTitle')}>
          <ul className="flex flex-wrap gap-2">
            {TECH_STACK.map((name) => (
              <li key={name} className="rounded-full bg-raised px-3 py-1 text-xs font-medium text-ink">
                {name}
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('ui.about.creditTitle')}>{t('ui.app.credit', { author: AUTHOR_NAME })}</Card>
        <Card title={t('ui.about.repoTitle')}>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary-strong underline-offset-2 hover:underline"
          >
            {t('ui.about.repoLink')}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </Card>
      </div>
    </div>
  );
}
