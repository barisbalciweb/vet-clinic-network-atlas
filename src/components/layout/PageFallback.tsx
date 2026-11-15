/** Shown for the moment a page's code is loading. */
import { PawMark } from '../common/PawMark';
import { useT } from '../../i18n/I18nContext';

export function PageFallback() {
  const t = useT();
  return (
    <div className="flex h-full min-h-48 items-center justify-center" role="status">
      <PawMark className="h-10 w-10 animate-pulse text-primary-soft" />
      <span className="sr-only">{t('ui.app.loading')}</span>
    </div>
  );
}
