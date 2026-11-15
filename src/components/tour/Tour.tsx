/**
 * First-visit tour: a few steps that point at the real controls (mode, language, modules, map, help).
 * Targets are found by `data-tour="<id>"`; the first visible element wins, so the same step points at the
 * tab row on desktop and at the menu button on a phone. Steps without a visible target show centred.
 * Seen once, it stays closed (localStorage); the "?" button in the header starts it again.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { readStorage, writeStorage } from '../../hooks/useLocalStorage';
import { navigate, useHashRoute } from '../../hooks/useHashRoute';
import { PawMark } from '../common/PawMark';

interface Step {
  id: 'welcome' | 'mode' | 'lang' | 'nav' | 'map' | 'help';
  /** Route the step needs (the map step opens the map) */
  route?: string;
}
const STEPS: Step[] = [{ id: 'welcome' }, { id: 'mode' }, { id: 'lang' }, { id: 'nav' }, { id: 'map', route: '' }, { id: 'help' }];
const DONE_KEY = 'tourDone';
const GAP = 12;
const PAD = 6;

const TourContext = createContext<{ start: () => void }>({ start: () => {} });
export const useTour = () => useContext(TourContext);

function visibleTarget(id: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<number | null>(() => (readStorage(DONE_KEY, false) ? null : 0));
  const start = useCallback(() => setStep(0), []);
  const close = useCallback(() => {
    writeStorage(DONE_KEY, true);
    setStep(null);
  }, []);
  return (
    <TourContext.Provider value={{ start }}>
      {children}
      {step !== null && <TourOverlay index={step} setIndex={setStep} close={close} />}
    </TourContext.Provider>
  );
}

function TourOverlay({ index, setIndex, close }: { index: number; setIndex: (i: number) => void; close: () => void }) {
  const { t } = useI18n();
  const route = useHashRoute();
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Open the page the step needs
  useEffect(() => {
    if (step.route !== undefined && route.path !== step.route) navigate(step.route);
  }, [step, route.path]);

  // Follow the target: it may appear late (lazy page) and move (resize, scroll)
  useEffect(() => {
    if (step.id === 'welcome') {
      setRect(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      const el = visibleTarget(step.id);
      setRect((old) => {
        const r = el?.getBoundingClientRect() ?? null;
        if (!r || !old) return r;
        return r.top === old.top && r.left === old.left && r.width === old.width && r.height === old.height ? old : r;
      });
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [step.id]);

  // Place the card next to the target, inside the screen
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!rect) {
      setBox({ top: Math.max(16, (vh - h) / 2), left: (vw - w) / 2 });
      return;
    }
    // A big target (the map) gets the card inside it, near the top
    const big = rect.height > vh * 0.5;
    let top = big ? rect.top + 24 : rect.bottom + GAP + PAD;
    if (!big && top + h > vh - 8) top = Math.max(8, rect.top - GAP - PAD - h);
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - w / 2), vw - w - 16);
    setBox({ top, left });
  }, [rect, index]);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && !last) setIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, last, close, setIndex]);

  const welcome = step.id === 'welcome';
  const big = rect && rect.height > window.innerHeight * 0.5;

  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      {/* Dim everything except the target */}
      {rect ? (
        <div
          key="spot"
          className="pointer-events-none fixed rounded-xl"
          style={{
            top: rect.top - (big ? 0 : PAD),
            left: rect.left - (big ? 0 : PAD),
            width: rect.width + (big ? 0 : 2 * PAD),
            height: rect.height + (big ? 0 : 2 * PAD),
            // Ring around the target, then the dimmed rest of the screen
            boxShadow: '0 0 0 2px var(--color-primary), 0 0 0 9999px rgb(0 0 0 / 0.55)',
          }}
          aria-hidden="true"
        />
      ) : (
        <div key="dim" className="fixed inset-0 bg-black/55" aria-hidden="true" />
      )}

      <div
        ref={popRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        className="fixed w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 shadow-xl"
        style={box ? { top: box.top, left: box.left } : { visibility: 'hidden' }}
      >
        <button
          type="button"
          onClick={close}
          aria-label={t('ui.tour.skip')}
          className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-raised hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        {welcome && (
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-on-primary">
            <PawMark className="h-6 w-6" />
          </span>
        )}
        <h2 id="tour-title" className="pr-10 text-base font-semibold text-ink">
          {t(`ui.tour.${step.id}.title`)}
        </h2>
        <p id="tour-text" className="mt-1.5 text-sm leading-relaxed text-ink">
          {t(`ui.tour.${step.id}.text`)}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-muted" aria-live="polite">
            {t('ui.tour.progress', { n: index + 1, total: STEPS.length })}
          </span>
          <div className="ml-auto flex gap-2">
            {welcome ? (
              <button type="button" onClick={close} className="min-h-11 rounded-xl px-3 text-sm font-medium text-muted hover:bg-raised hover:text-ink">
                {t('ui.tour.skip')}
              </button>
            ) : (
              <button type="button" onClick={() => setIndex(index - 1)} className="min-h-11 rounded-xl px-3 text-sm font-medium text-ink hover:bg-raised">
                {t('ui.tour.back')}
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              onClick={() => (last ? close() : setIndex(index + 1))}
              className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-strong"
            >
              {welcome ? t('ui.tour.start') : last ? t('ui.tour.done') : t('ui.tour.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
