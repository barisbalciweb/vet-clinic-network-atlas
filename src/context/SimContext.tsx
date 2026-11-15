/**
 * The failure simulation as app state: which faults are active, and what they cause.
 * It lives above all pages, so the map, the simulator and later the status board (Module H)
 * show the same broken network. Nothing is stored: a reload starts healthy again.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CLUSTER, FAULTS, INDEX, ISSUES, ROLES, TOPOLOGY, TOPOLOGY_OPENED } from '../data';
import { useOpening } from './OpeningContext';
import { simulate } from '../engine/simulate';
import { buildFault, explain, faultKey, type ActiveFault, type Explanation } from '../engine/explain';
import type { Quality, SimulationResult } from '../engine/types';

const RANK: Record<Quality, number> = { up: 0, degraded: 1, down: 2 };
const worst = (a: Quality, b: Quality): Quality => (RANK[a] >= RANK[b] ? a : b);

export interface DeviceSimState {
  state: Quality;
  /** The user broke this device directly */
  faulted: boolean;
}

interface Sim {
  active: ActiveFault[];
  result: SimulationResult;
  explanation: Explanation;
  isActive: (action: string, target: string) => boolean;
  /** Adds the fault, or removes it if it is already active. Returns true if it was added. */
  toggle: (action: string, target: string) => boolean;
  remove: (key: string) => void;
  reset: () => void;
  /** Replaces the active faults with a ready-made scenario; returns the site it is about */
  loadScenario: (id: string) => string | undefined;
  /** Replaces the active faults with those of a common issue (Module C); returns its site */
  loadIssue: (id: string) => string | undefined;
  /** Undefined while nothing is broken, so the map looks normal */
  deviceState: (id: string) => DeviceSimState | undefined;
  siteState: (id: string) => Quality | undefined;
}

const Ctx = createContext<Sim | null>(null);

export function SimProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveFault[]>([]);
  // Once München has gone live (Module D), the simulation includes it
  const { live } = useOpening();

  const result = useMemo(
    () =>
      simulate(
        live ? TOPOLOGY_OPENED : TOPOLOGY,
        active.map((a) => a.fault),
        { roles: ROLES, cluster: CLUSTER },
      ),
    [active, live],
  );
  const explanation = useMemo(() => explain(FAULTS, INDEX, active, result), [active, result]);

  const isActive = useCallback((action: string, target: string) => active.some((a) => a.action === action && a.target === target), [active]);

  const toggle = useCallback(
    (action: string, target: string) => {
      const key = faultKey({ action, target });
      if (active.some((a) => faultKey(a) === key)) {
        setActive(active.filter((a) => faultKey(a) !== key));
        return false;
      }
      const fault = buildFault(FAULTS, INDEX, action, target);
      if (!fault) return false;
      setActive([...active, fault]);
      return true;
    },
    [active],
  );

  const remove = useCallback((key: string) => setActive((list) => list.filter((a) => faultKey(a) !== key)), []);
  const reset = useCallback(() => setActive([]), []);

  const loadScenario = useCallback((id: string) => {
    const scenario = FAULTS.scenarios.find((s) => s.id === id);
    if (!scenario) return undefined;
    setActive(scenario.faults.map((f) => buildFault(FAULTS, INDEX, f.action, f.target)).filter((f): f is ActiveFault => !!f));
    return scenario.site;
  }, []);

  const loadIssue = useCallback((id: string) => {
    const issue = ISSUES.issues.find((i) => i.id === id);
    if (!issue?.simulate) return undefined;
    setActive(issue.simulate.map((f) => buildFault(FAULTS, INDEX, f.action, f.target)).filter((f): f is ActiveFault => !!f));
    return issue.show.site;
  }, []);

  const siteStates = useMemo(() => {
    const map = new Map<string, Quality>();
    if (active.length === 0) return map;
    const add = (site: string, q: Quality) => map.set(site, worst(map.get(site) ?? 'up', q));
    for (const [id, s] of Object.entries(result.sites)) add(id, s.state);
    for (const a of result.affected) add(a.site, a.state);
    // A device that is out but whose loss is absorbed still makes the site "degraded"
    for (const [id, d] of Object.entries(result.devices)) {
      const site = INDEX.devices.get(id)?.site;
      if (site && d.state !== 'up') add(site, 'degraded');
    }
    return map;
  }, [active, result]);

  const deviceState = useCallback(
    (id: string): DeviceSimState | undefined => {
      if (active.length === 0) return undefined;
      const d = result.devices[id];
      if (!d) return undefined;
      return { state: d.state, faulted: active.some((a) => a.target === id) };
    },
    [active, result],
  );
  const siteState = useCallback((id: string) => siteStates.get(id), [siteStates]);

  const value = useMemo<Sim>(
    () => ({ active, result, explanation, isActive, toggle, remove, reset, loadScenario, loadIssue, deviceState, siteState }),
    [active, result, explanation, isActive, toggle, remove, reset, loadScenario, loadIssue, deviceState, siteState],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSim(): Sim {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSim must be used inside <SimProvider>');
  return v;
}
