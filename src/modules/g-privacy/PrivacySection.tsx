/** "Data protection here": the measures for one device, inside the map's details panel. */
import { ShieldCheck } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import type { Measure } from '../../schema/compliance';
import { CategoryIcons } from './PrivacyPage';

export function PrivacySection({ measures }: { measures: Measure[] }) {
  const { t, td } = useI18n();
  return (
    <section className="mt-4 rounded-xl border border-primary/40 bg-primary-soft/50 p-3" aria-label={t('privacy.ui.panelTitle')}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <ShieldCheck className="h-4 w-4 text-primary-strong" aria-hidden="true" />
        {t('privacy.ui.panelTitle')}
      </h3>
      <ul className="mt-2 space-y-2">
        {measures.map((m) => (
          <li key={m.id} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{td(`privacy.measure.${m.id}.title`)}</span>
              <CategoryIcons categories={m.categories} />
            </div>
            <p className="text-muted">{td(`privacy.measure.${m.id}.example`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
