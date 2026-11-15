/** One quiet line at the bottom of every page: this is a fictional environment. */
import { hrefFor } from '../../hooks/useHashRoute';
import { useT } from '../../i18n/I18nContext';
import { ABOUT_PATH } from '../../modules/registry';

export function Footer() {
  const t = useT();
  return (
    <footer className="border-t border-line bg-surface px-4 py-2 text-xs text-muted">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span>{t('ui.app.fictional')}</span>
        <a href={hrefFor(ABOUT_PATH)} className="font-medium text-primary-strong underline-offset-2 hover:underline">
          {t('ui.nav.about')}
        </a>
      </div>
    </footer>
  );
}
