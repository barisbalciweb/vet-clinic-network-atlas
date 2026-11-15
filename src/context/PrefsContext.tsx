/**
 * User preferences that apply to the whole app: theme and Simple/Technical view mode.
 * Both are stored in the browser. The theme falls back to the operating system preference
 * until the user picks one. (The language lives in I18nContext.)
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readStorage, useLocalStorage, writeStorage } from '../hooks/useLocalStorage';

export type Theme = 'light' | 'dark';
/** simple = plain language for clinic staff · technical = full detail for IT */
export type ViewMode = 'simple' | 'technical';

interface Prefs {
  theme: Theme;
  toggleTheme: () => void;
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
}

const Ctx = createContext<Prefs | null>(null);

function initialTheme(): Theme {
  const stored = readStorage<Theme | null>('theme', null);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [mode, setMode] = useLocalStorage<ViewMode>('mode', 'simple');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      writeStorage('theme', next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme, mode, setMode }), [theme, toggleTheme, mode, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return v;
}
