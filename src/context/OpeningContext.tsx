/**
 * Progress of the München opening (Module D). Once every step up to go-live is ticked, the site
 * counts as live: the map draws it like the other clinics and the failure simulator includes it.
 * Kept in memory only, like the simulator's faults.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { INDEX, PLAYBOOK } from '../data';
import { checkKey, isLive } from '../schema/playbook';

export type SiteStatus = 'live' | 'planned';

interface Opening {
  done: ReadonlySet<string>;
  toggle: (phase: string, item: string) => void;
  /** Ticks (or unticks) every item of a phase */
  setPhase: (phase: string, checked: boolean) => void;
  reset: () => void;
  live: boolean;
  /** Status of a site right now: the opened site counts as live once go-live is done */
  siteStatus: (siteId: string) => SiteStatus;
  /** Items the procurement delivers too late for the installation (days late) */
  late: ReadonlyArray<{ sku: string; days: number }>;
  setLate: (late: ReadonlyArray<{ sku: string; days: number }>) => void;
}

const Ctx = createContext<Opening | null>(null);

export function OpeningProvider({ children }: { children: ReactNode }) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [late, setLate] = useState<ReadonlyArray<{ sku: string; days: number }>>([]);

  const toggle = useCallback((phase: string, item: string) => {
    setDone((cur) => {
      const next = new Set(cur);
      const key = checkKey(phase, item);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const setPhase = useCallback((phaseId: string, checked: boolean) => {
    const phase = PLAYBOOK.phases.find((p) => p.id === phaseId);
    if (!phase) return;
    setDone((cur) => {
      const next = new Set(cur);
      for (const item of phase.checklist) {
        if (checked) next.add(checkKey(phaseId, item));
        else next.delete(checkKey(phaseId, item));
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setDone(new Set());
    setLate([]);
  }, []);
  const live = useMemo(() => isLive(PLAYBOOK, done), [done]);
  const siteStatus = useCallback(
    (siteId: string): SiteStatus => (siteId === PLAYBOOK.site && live ? 'live' : INDEX.sites.get(siteId)?.status === 'planned' ? 'planned' : 'live'),
    [live],
  );

  const value = useMemo(() => ({ done, toggle, setPhase, reset, live, siteStatus, late, setLate }), [done, toggle, setPhase, reset, live, siteStatus, late]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOpening(): Opening {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOpening must be used inside <OpeningProvider>');
  return v;
}
