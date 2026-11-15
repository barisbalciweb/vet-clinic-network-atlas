/**
 * State of the HA lab: what the user broke, where every VM runs, what is animating, and the log.
 *
 * Network effects (power, ISPs, firewall pair, switches) come from the main simulation engine,
 * so a UPS failure here behaves exactly like on the map. VM placement, maintenance mode,
 * isolation and DRS come from engine/haLab.ts. The lab is its own playground: it does not change
 * the faults of the failure simulator.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CLUSTER, INDEX, ROLES, TOPOLOGY } from '../../data';
import { simulate } from '../../engine/simulate';
import type { Fault, SimulationResult } from '../../engine/types';
import {
  drsRecommend,
  hostHealth,
  initialRuntime,
  loadPct,
  reconcile,
  scaleCluster,
  type HostHealth,
  type HostStatus,
  type IsolationResponse,
  type Move,
  type Runtime,
} from '../../engine/haLab';

export interface Controls {
  /** Devices switched off and links cut by the user */
  failed: ReadonlySet<string>;
  maintenance: ReadonlySet<string>;
  isolated: ReadonlySet<string>;
  response: IsolationResponse;
}

/** A VM shown on its old host while it is down or being moved */
export type Display = Record<string, { kind: 'down' | 'migrating'; from: string }>;

/** Ids, not names: names are resolved when the log is drawn, in the current language and mode */
export type LogParams = Partial<Record<'host' | 'vm' | 'name', string>> & { gb?: number; count?: number };
export interface LogLine {
  /** Illustrative seconds after the action */
  at: number;
  key: string;
  params: LogParams;
}
export interface LogGroup {
  id: number;
  lines: LogLine[];
}

const EMPTY: Controls = { failed: new Set(), maintenance: new Set(), isolated: new Set(), response: 'keep-running' };
const BROKEN: ReadonlySet<HostStatus> = new Set(['failed', 'no-network', 'no-storage']);
const STATUS_LINE: Partial<Record<HostStatus, string>> = { 'no-network': 'ha.log.hostNoNetwork', 'no-storage': 'ha.log.hostNoStorage', failed: 'ha.log.hostFailed' };
/** Real time between animation steps, in milliseconds */
const STEP_MS = 650;
const MAX_LOG_GROUPS = 6;

function faultsOf(failed: ReadonlySet<string>): Fault[] {
  return [...failed].map((id) => (INDEX.devices.has(id) ? { type: 'power-off', target: { kind: 'device', id } } : { type: 'link-cut', target: { kind: 'link', id } }));
}

function network(c: Controls): SimulationResult {
  return simulate(TOPOLOGY, faultsOf(c.failed), { roles: ROLES, cluster: CLUSTER });
}

function healthOf(c: Controls, net: SimulationResult): Record<string, HostHealth> {
  return hostHealth(TOPOLOGY, CLUSTER, {
    deviceOn: (id) => net.devices[id]?.on ?? true,
    cutLinks: new Set([...c.failed].filter((id) => INDEX.links.has(id))),
    maintenance: c.maintenance,
    isolated: c.isolated,
  });
}

const toggled = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
};

export function useHaLab() {
  const [load, setLoad] = useState(() => Math.round(loadPct(CLUSTER)));
  const cluster = useMemo(() => scaleCluster(CLUSTER, load), [load]);
  const [controls, setControls] = useState<Controls>(EMPTY);
  const [runtime, setRuntime] = useState<Runtime>(() => initialRuntime(TOPOLOGY, CLUSTER));
  const [display, setDisplay] = useState<Display>({});
  const [log, setLog] = useState<LogGroup[]>([]);

  const net = useMemo(() => network(controls), [controls]);
  const health = useMemo(() => healthOf(controls, net), [controls, net]);

  // Latest values for the action handlers (they run after async animation steps too)
  const latest = useRef({ controls, runtime, health, cluster });
  latest.current = { controls, runtime, health, cluster };
  const timers = useRef<number[]>([]);
  const groupId = useRef(0);
  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const addLog = useCallback((lines: LogLine[]) => setLog((groups) => [{ id: ++groupId.current, lines }, ...groups].slice(0, MAX_LOG_GROUPS)), []);

  /** Animates VMs off their old hosts: one step per restart wave or per vMotion. */
  const animate = useCallback((steps: string[][], disp: Display) => {
    clearTimers();
    setDisplay(disp);
    steps.forEach((vms, i) => {
      timers.current.push(
        window.setTimeout(
          () =>
            setDisplay((d) => {
              const next = { ...d };
              vms.forEach((vm) => delete next[vm]);
              return next;
            }),
          STEP_MS * (i + 1),
        ),
      );
    });
  }, [clearTimers]);

  /** Applies new controls: network, host health, HA / vMotion, animation and log. */
  const apply = useCallback((next: Controls, lines: LogLine[], opts: { failure?: boolean } = {}) => {
    const { runtime: prev, health: prevHealth, cluster: cl } = latest.current;
    const nextNet = network(next);
    const nextHealth = healthOf(next, nextNet);

    // Hosts that broke as a side effect (both uplinks, all paths, power)
    for (const h of cl.hosts) {
      const before = prevHealth[h.id]?.status;
      const after = nextHealth[h.id].status;
      if (after !== before && BROKEN.has(after) && !lines.some((l) => l.params.host === h.id)) lines.push({ at: 0, key: STATUS_LINE[after]!, params: { host: h.id } });
    }

    const vcHost = prev['hq-vcenter']?.host;
    const vcenterRunning = !!vcHost && ['ok', 'maintenance', 'isolated'].includes(nextHealth[vcHost]?.status);
    const { runtime: nextRt, transitions } = reconcile(cl, prev, nextHealth, next.response, vcenterRunning);
    const ram = new Map(cl.vms.map((v) => [v.id, Math.round(v.ramGb)]));
    const { detectionSec, waveGapSec, bootSec, vmotionSec } = CLUSTER.ha;

    const disp: Display = {};
    const steps: string[][] = [];
    const restarts = transitions.filter((t) => t.kind === 'restart' || t.kind === 'no-capacity');
    if (restarts.some((t) => t.from)) lines.push({ at: detectionSec, key: 'ha.log.detect', params: {} });
    const waves = [...new Set(restarts.map((t) => t.priority))].sort();
    waves.forEach((p, i) => {
      const at = detectionSec + i * waveGapSec + bootSec;
      const wave = restarts.filter((t) => t.priority === p);
      for (const t of wave) {
        if (t.from) disp[t.vm] = { kind: 'down', from: t.from };
        lines.push(t.kind === 'restart' ? { at, key: 'ha.log.restarted', params: { vm: t.vm, host: t.to! } } : { at, key: 'ha.log.noCapacity', params: { vm: t.vm, gb: ram.get(t.vm) } });
      }
      steps.push(wave.map((t) => t.vm));
    });
    const migrations = transitions.filter((t) => t.kind === 'migrate');
    migrations.forEach((t, i) => {
      disp[t.vm] = { kind: 'migrating', from: t.from! };
      lines.push({ at: (i + 1) * vmotionSec, key: 'ha.log.migrated', params: { vm: t.vm, host: t.to! } });
      steps.push([t.vm]);
    });
    for (const t of transitions.filter((x) => x.kind === 'stuck')) lines.push({ at: 0, key: 'ha.log.stuck', params: { vm: t.vm, host: t.from! } });
    const entering = [...next.maintenance].find((h) => !latest.current.controls.maintenance.has(h));
    if (entering && !transitions.some((t) => t.kind === 'stuck')) lines.push({ at: migrations.length * vmotionSec + 1, key: 'ha.log.maintenanceDone', params: { host: entering } });
    if (opts.failure && transitions.length === 0) lines.push({ at: 0, key: 'ha.log.noImpact', params: {} });

    setControls(next);
    setRuntime(nextRt);
    animate(steps, disp);
    addLog(lines);
  }, [animate, addLog]);

  const toggleComponent = useCallback(
    (id: string) => {
      const c = latest.current.controls;
      const failing = !c.failed.has(id);
      const isHost = latest.current.cluster.hosts.some((h) => h.id === id);
      const key = isHost ? (failing ? 'ha.log.hostFailed' : 'ha.log.restored') : failing ? 'ha.log.componentFailed' : 'ha.log.componentRestored';
      apply({ ...c, failed: toggled(c.failed, id) }, [{ at: 0, key, params: isHost ? { host: id } : { name: id } }], { failure: failing });
    },
    [apply],
  );

  const toggleMaintenance = useCallback(
    (host: string) => {
      const c = latest.current.controls;
      const entering = !c.maintenance.has(host);
      apply({ ...c, maintenance: toggled(c.maintenance, host) }, [{ at: 0, key: entering ? 'ha.log.maintenance' : 'ha.log.exitMaintenance', params: { host } }]);
    },
    [apply],
  );

  const toggleIsolation = useCallback(
    (host: string) => {
      const c = latest.current.controls;
      const isolating = !c.isolated.has(host);
      const lines: LogLine[] = [{ at: 0, key: isolating ? 'ha.log.isolated' : 'ha.log.reconnected', params: { host } }];
      if (isolating && c.response === 'keep-running') lines.push({ at: CLUSTER.ha.detectionSec, key: 'ha.log.isolatedKeep', params: {} });
      apply({ ...c, isolated: toggled(c.isolated, host) }, lines);
    },
    [apply],
  );

  const setResponse = useCallback(
    (response: IsolationResponse) => {
      const c = latest.current.controls;
      if (c.response !== response) apply({ ...c, response }, [{ at: 0, key: 'ha.log.responseChanged', params: {} }]);
    },
    [apply],
  );

  /** "Try it" from the SPOF table: make sure the component is broken (never repairs it). */
  const breakComponent = useCallback(
    (id: string) => {
      if (!latest.current.controls.failed.has(id)) toggleComponent(id);
    },
    [toggleComponent],
  );

  const applyDrs = useCallback((moves: Move[]) => {
    if (moves.length === 0) return;
    const prev = latest.current.runtime;
    const next: Runtime = { ...prev };
    const disp: Display = {};
    const lines: LogLine[] = [{ at: 0, key: 'ha.log.drs', params: { count: moves.length } }];
    moves.forEach((m, i) => {
      next[m.vm] = { ...next[m.vm], host: m.to };
      disp[m.vm] = { kind: 'migrating', from: m.from };
      lines.push({ at: (i + 1) * CLUSTER.ha.vmotionSec, key: 'ha.log.migrated', params: { vm: m.vm, host: m.to } });
    });
    setRuntime(next);
    animate(
      moves.map((m) => [m.vm]),
      disp,
    );
    addLog(lines);
  }, [animate, addLog]);

  const reset = useCallback(() => {
    clearTimers();
    setControls(EMPTY);
    setRuntime(initialRuntime(TOPOLOGY, CLUSTER));
    setDisplay({});
    setLog([]);
    setLoad(Math.round(loadPct(CLUSTER)));
  }, [clearTimers]);

  const vcHost = runtime['hq-vcenter']?.host;
  const vcenterUp = !!vcHost && !display['hq-vcenter'] && ['ok', 'maintenance', 'isolated'].includes(health[vcHost]?.status);
  const moves = useMemo(() => drsRecommend(cluster, runtime, health), [cluster, runtime, health]);

  return {
    cluster,
    load,
    setLoad,
    controls,
    runtime,
    display,
    log,
    net,
    health,
    vcenterUp,
    moves,
    toggleComponent,
    breakComponent,
    toggleMaintenance,
    toggleIsolation,
    setResponse,
    applyDrs,
    reset,
  };
}

export type HaLab = ReturnType<typeof useHaLab>;
