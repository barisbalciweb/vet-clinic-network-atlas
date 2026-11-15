/**
 * Top bar: logo, Simple/Technical, language, theme – always visible – and the module navigation.
 * Wide screens show the modules as a tab row; below "lg" they collapse into a menu.
 * Phones get two rows: logo + menu button, then the three switches.
 */
import { useEffect, useState } from 'react';
import { Info, Menu, Moon, Sun, X } from 'lucide-react';
import { ORG_NAME } from '../../config';
import { usePrefs, type ViewMode } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import { LANGS, LANG_NAMES, type Lang } from '../../i18n/dictionaries';
import { hrefFor } from '../../hooks/useHashRoute';
import { ABOUT_PATH, MODULES, moduleForPath } from '../../modules/registry';
import { Segmented } from '../common/Segmented';
import { PawMark } from '../common/PawMark';
import { cn } from '../../utils/cn';

export function Header({ path }: { path: string }) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggleTheme, mode, setMode } = usePrefs();
  const [menuOpen, setMenuOpen] = useState(false);

  // Navigating closes the menu; so does Esc
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const items = [
    ...MODULES.map((m) => ({ path: m.path, label: t(`ui.nav.${m.id}`), icon: m.icon })),
    { path: ABOUT_PATH, label: t('ui.nav.about'), icon: Info },
  ];
  const currentPath = path === ABOUT_PATH ? ABOUT_PATH : moduleForPath(path).path;
  const isCurrent = (p: string) => p === currentPath;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
        <a href={hrefFor('')} aria-label={t('ui.header.home')} className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
            <PawMark className="h-6 w-6" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold text-ink">{ORG_NAME}</span>
            <span className="block truncate text-xs text-muted">{t('ui.app.subtitle')}</span>
          </span>
        </a>

        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-controls="module-menu"
          aria-label={menuOpen ? t('ui.header.closeMenu') : t('ui.header.menu')}
          className="order-2 ml-auto flex h-11 w-11 items-center justify-center rounded-xl text-ink hover:bg-raised sm:order-3 sm:ml-0 lg:hidden"
        >
          {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>

        <div className="order-3 flex w-full items-center justify-between gap-2 sm:order-2 sm:ml-auto sm:w-auto sm:justify-end">
          <Segmented<ViewMode>
            label={t('ui.header.mode')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'simple', label: t('ui.header.simple'), title: t('ui.header.simpleHint') },
              { value: 'technical', label: t('ui.header.technical'), title: t('ui.header.technicalHint') },
            ]}
          />
          <div className="flex items-center gap-2">
            <Segmented<Lang>
              label={t('ui.header.language')}
              value={lang}
              onChange={setLang}
              options={LANGS.map((l) => ({ value: l, label: l.toUpperCase(), title: LANG_NAMES[l], name: LANG_NAMES[l] }))}
            />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('ui.header.toLight') : t('ui.header.toDark')}
              title={theme === 'dark' ? t('ui.header.toLight') : t('ui.header.toDark')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink hover:bg-raised"
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>

      {/* Wide screens: tab row */}
      <nav aria-label={t('ui.header.modules')} className="mx-auto hidden max-w-7xl px-4 lg:block">
        <ul className="flex gap-1">
          {items.map((it) => {
            const current = isCurrent(it.path);
            return (
              <li key={it.path} className={cn(it.path === ABOUT_PATH && 'ml-auto')}>
                <a
                  href={hrefFor(it.path)}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-sm font-medium transition-colors',
                    current ? 'border-primary text-primary-strong' : 'border-transparent text-muted hover:text-ink',
                  )}
                >
                  <it.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {it.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Narrow screens: menu */}
      {menuOpen && (
        <nav id="module-menu" aria-label={t('ui.header.modules')} className="border-t border-line bg-surface px-2 pb-2 pt-1 lg:hidden">
          <ul className="mx-auto grid max-w-7xl gap-0.5 sm:grid-cols-2">
            {items.map((it) => {
              const current = isCurrent(it.path);
              return (
                <li key={it.path}>
                  <a
                    href={hrefFor(it.path)}
                    aria-current={current ? 'page' : undefined}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium',
                      current ? 'bg-primary-soft text-primary-strong' : 'text-ink hover:bg-raised',
                    )}
                  >
                    <it.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {it.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
