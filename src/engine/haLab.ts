/**
 * The logic of the HA lab (Module F). Pure functions, no UI.
 *
 *  hostHealth   which hosts can carry VMs: power, uplinks to the two core switches, storage paths,
 *               maintenance mode, isolation
 *  reconcile    one step of vSphere HA / vMotion: VMs on failed hosts are restarted elsewhere
 *               (outage), VMs on hosts entering maintenance are moved live (no outage)
 *  drsRecommend DRS: moves that even out memory use between hosts
 *  admission    N+1 admission control: how much load the cluster may carry and still absorb a host
 *  failureImpact which VMs could not restart if a given host failed right now
 *
 * Storage is modelled as two fabrics: host uplink to core switch N + controller port on core
 * switch N = one path. That is how a dual-controller array with multipathing is usually cabled.
 */
import type { Topology } from '../schema/topology.schema';
import { placeVms, type ClusterData } from './cluster';

export type HostStatus = 'ok' | 'failed' | 'maintenance' | 'isolated' | 'no-network' | 'no-storage';
export type IsolationResponse = 'keep-running' | 'power-off';

export interface LabInput {
  /** Device is powered and running (taken from the network engine, so a UPS failure counts) */
  deviceOn: (id: string) => boolean;
  /** Links the user cut */
  cutLinks: ReadonlySet<string>;
  maintenance: ReadonlySet<string>;
  isolated: ReadonlySet<string>;
}

export interface Uplink {
  link: string;
  port?: string;
  core: string;
  up: boolean;
}

export interface HostHealth {
  id: string;
  status: HostStatus;
  uplinks: Uplink[];
  storagePaths: number;
  storagePathsTotal: number;
}

export interface StoragePort {
  link: string;
  controller: string;
  core: string;
  up: boolean;
}

/** The controller ports of the array, one per controller and core switch. */
export function storagePorts(topo: Topology, cluster: ClusterData, input: Pick<LabInput, 'deviceOn' | 'cutLinks'>): StoragePort[] {
  const controllers = new Set(cluster.storage.controllers);
  return topo.links
    .filter((l) => l.kind === 'storage' && (controllers.has(l.a.device) || controllers.has(l.b.device)))
    .map((l) => {
      const controller = controllers.has(l.a.device) ? l.a.device : l.b.device;
      const core = controller === l.a.device ? l.b.device : l.a.device;
      return { link: l.id, controller, core, up: !input.cutLinks.has(l.id) && input.deviceOn(controller) && input.deviceOn(core) };
    });
}

export function hostHealth(topo: Topology, cluster: ClusterData, input: LabInput): Record<string, HostHealth> {
  const cores = new Set(topo.devices.filter((d) => d.role === 'core-switch').map((d) => d.id));
  const ports = storagePorts(topo, cluster, input);
  const result: Record<string, HostHealth> = {};
  for (const h of cluster.hosts) {
    const uplinks: Uplink[] = topo.links
      .filter((l) => (l.a.device === h.id && cores.has(l.b.device)) || (l.b.device === h.id && cores.has(l.a.device)))
      .map((l) => {
        const core = l.a.device === h.id ? l.b.device : l.a.device;
        const port = l.a.device === h.id ? l.a.port : l.b.port;
        return { link: l.id, port, core, up: !input.cutLinks.has(l.id) && input.deviceOn(core) };
      });
    const upCores = new Set(uplinks.filter((u) => u.up).map((u) => u.core));
    const storagePaths = ports.filter((p) => p.up && upCores.has(p.core)).length;
    const storagePathsTotal = uplinks.length * cluster.storage.controllers.length;

    let status: HostStatus = 'ok';
    if (!input.deviceOn(h.id)) status = 'failed';
    else if (upCores.size === 0) status = 'no-network';
    else if (storagePaths === 0) status = 'no-storage';
    else if (input.maintenance.has(h.id)) status = 'maintenance';
    else if (input.isolated.has(h.id)) status = 'isolated';
    result[h.id] = { id: h.id, status, uplinks, storagePaths, storagePathsTotal };
  }
  return result;
}

// --- HA and vMotion --------------------------------------------------------------------------

export interface VmRuntime {
  /** Host the VM runs on; null = not running */
  host: string | null;
  /** Came back through an HA restart (had an outage) */
  restarted?: boolean;
}
export type Runtime = Record<string, VmRuntime>;

export type TransitionKind = 'restart' | 'migrate' | 'no-capacity' | 'stuck';
export interface Transition {
  vm: string;
  kind: TransitionKind;
  from: string | null;
  to: string | null;
  priority: number;
}

export function initialRuntime(topo: Topology, cluster: ClusterData): Runtime {
  const runsOn = new Map(topo.devices.filter((d) => d.runsOn).map((d) => [d.id, d.runsOn!]));
  return Object.fromEntries(cluster.vms.map((vm) => [vm.id, { host: runsOn.get(vm.id) ?? null }]));
}

/** HA keeps VMs on these hosts running */
const KEEPS_VMS: ReadonlySet<HostStatus> = new Set(['ok']);

/**
 * One step after something changed. Returns the new runtime and what happened to each VM, in the
 * order HA would do it (restart priority first).
 *
 *  - VM on an ok host: stays.
 *  - VM on an isolated host with "keep running": stays (the host is alive, just unreachable).
 *  - VM on a host in maintenance: moved live with vMotion – only while vCenter runs; otherwise stuck.
 *  - VM on a failed host, a host without network or storage, or an isolated host with "power off":
 *    stops and is restarted elsewhere by HA.
 *  - VM that is not running: HA tries again (e.g. after a host came back).
 */
export function reconcile(
  cluster: ClusterData,
  runtime: Runtime,
  health: Record<string, HostHealth>,
  response: IsolationResponse,
  vcenterRunning: boolean,
): { runtime: Runtime; transitions: Transition[] } {
  const next: Runtime = {};
  const stay = new Map<string, string>();
  const pinned = new Set<string>();
  const want = new Map<string, TransitionKind>();

  for (const vm of cluster.vms) {
    const cur = runtime[vm.id] ?? { host: null };
    const status = cur.host ? health[cur.host]?.status : undefined;
    if (cur.host && status && KEEPS_VMS.has(status)) stay.set(vm.id, cur.host);
    else if (cur.host && status === 'isolated' && response === 'keep-running') pinned.add(vm.id);
    else if (cur.host && status === 'maintenance') {
      if (vcenterRunning) want.set(vm.id, 'migrate');
      else pinned.add(vm.id);
    } else want.set(vm.id, 'restart');
    next[vm.id] = cur;
  }

  const movable: ClusterData = { ...cluster, vms: cluster.vms.filter((v) => !pinned.has(v.id)) };
  const placed = placeVms(movable, stay, (h) => health[h]?.status === 'ok');
  const priority = new Map(cluster.vms.map((v) => [v.id, v.restartPriority]));
  const transitions: Transition[] = [];

  for (const [vm, kind] of want) {
    const from = runtime[vm]?.host ?? null;
    const target = placed.get(vm)?.host ?? null;
    const p = priority.get(vm) ?? 4;
    if (target) {
      next[vm] = { host: target, restarted: kind === 'restart' ? true : runtime[vm]?.restarted };
      transitions.push({ vm, kind, from, to: target, priority: p });
    } else if (kind === 'migrate') {
      transitions.push({ vm, kind: 'stuck', from, to: null, priority: p });
    } else {
      next[vm] = { host: null };
      // A VM that was already off and still does not fit is not news
      if (from !== null) transitions.push({ vm, kind: 'no-capacity', from, to: null, priority: p });
    }
  }
  const order = (t: Transition) => [t.kind === 'migrate' || t.kind === 'stuck' ? 0 : 1, t.priority];
  transitions.sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1] || a.vm.localeCompare(b.vm));
  // Pinned VMs (isolated host, or maintenance without vCenter) stay where they were
  for (const vm of pinned) next[vm] = runtime[vm];
  return { runtime: next, transitions };
}

// --- DRS -------------------------------------------------------------------------------------

export interface Move {
  vm: string;
  from: string;
  to: string;
}

export function hostUsage(cluster: ClusterData, runtime: Runtime): Map<string, number> {
  const used = new Map(cluster.hosts.map((h) => [h.id, 0]));
  for (const vm of cluster.vms) {
    const h = runtime[vm.id]?.host;
    if (h && used.has(h)) used.set(h, used.get(h)! + vm.ramGb);
  }
  return used;
}

/** Spread of memory use between the most and the least loaded usable host, in percentage points */
export function imbalance(cluster: ClusterData, runtime: Runtime, usable: string[]): number {
  if (usable.length < 2) return 0;
  const used = hostUsage(cluster, runtime);
  const pct = usable.map((id) => (100 * used.get(id)!) / cluster.hosts.find((h) => h.id === id)!.ramGb);
  return Math.max(...pct) - Math.min(...pct);
}

/** Greedy DRS: move one VM at a time from the fullest host while that reduces the spread. */
export function drsRecommend(cluster: ClusterData, runtime: Runtime, health: Record<string, HostHealth>): Move[] {
  const usable = cluster.hosts.filter((h) => health[h.id]?.status === 'ok').map((h) => h.id);
  const ram = new Map(cluster.hosts.map((h) => [h.id, h.ramGb]));
  const partners = (vm: string) => cluster.rules.filter((r) => r.vms.includes(vm)).flatMap((r) => r.vms.filter((v) => v !== vm));
  const state: Runtime = { ...runtime };
  const moves: Move[] = [];

  for (let i = 0; i < 10; i++) {
    const spread = imbalance(cluster, state, usable);
    if (spread <= cluster.drs.thresholdPct) break;
    const used = hostUsage(cluster, state);
    const source = [...usable].sort((a, b) => used.get(b)! / ram.get(b)! - used.get(a)! / ram.get(a)!)[0];
    let best: { move: Move; spread: number } | undefined;
    for (const vm of cluster.vms.filter((v) => state[v.id]?.host === source)) {
      for (const to of usable) {
        if (to === source || used.get(to)! + vm.ramGb > ram.get(to)!) continue;
        if (partners(vm.id).some((p) => state[p]?.host === to)) continue;
        const trial = { ...state, [vm.id]: { ...state[vm.id], host: to } };
        const s = imbalance(cluster, trial, usable);
        if (!best || s < best.spread) best = { move: { vm: vm.id, from: source, to }, spread: s };
      }
    }
    if (!best || best.spread >= spread) break;
    moves.push(best.move);
    state[best.move.vm] = { ...state[best.move.vm], host: best.move.to };
  }
  return moves;
}

// --- Admission control -------------------------------------------------------------------------

export interface Admission {
  capacityGb: number;
  reserveGb: number;
  usedGb: number;
  usedPct: number;
  /** Highest load at which one host failure is still absorbed */
  limitPct: number;
  ok: boolean;
}

export function admission(cluster: ClusterData): Admission {
  const capacityGb = cluster.hosts.reduce((s, h) => s + h.ramGb, 0);
  const reserveGb = Math.max(...cluster.hosts.map((h) => h.ramGb));
  const usedGb = cluster.vms.reduce((s, v) => s + v.ramGb, 0);
  return {
    capacityGb,
    reserveGb,
    usedGb,
    usedPct: (100 * usedGb) / capacityGb,
    limitPct: (100 * (capacityGb - reserveGb)) / capacityGb,
    ok: usedGb <= capacityGb - reserveGb,
  };
}

export const loadPct = (cluster: ClusterData) => admission(cluster).usedPct;

/** The same VMs, each scaled so that together they use `pct` % of the cluster's memory. */
export function scaleCluster(cluster: ClusterData, pct: number): ClusterData {
  const factor = pct / loadPct(cluster);
  return { ...cluster, vms: cluster.vms.map((v) => ({ ...v, ramGb: Math.round(v.ramGb * factor * 10) / 10 })) };
}

/** For each host: the VMs HA could not restart if that host failed now. */
export function failureImpact(cluster: ClusterData, runtime: Runtime, health: Record<string, HostHealth>): Array<{ host: string; lost: string[] }> {
  const placement = new Map(Object.entries(runtime).filter(([, r]) => r.host).map(([vm, r]) => [vm, r.host!]));
  return cluster.hosts
    .filter((h) => health[h.id]?.status === 'ok')
    .map((h) => {
      const placed = placeVms(cluster, placement, (id) => id !== h.id && health[id]?.status === 'ok');
      return { host: h.id, lost: [...placed].filter(([vm, p]) => !p.host && runtime[vm]?.host).map(([vm]) => vm) };
    });
}

export interface RuleStatus {
  vms: string[];
  state: 'ok' | 'violated' | 'not-running';
}

export function ruleStatus(cluster: ClusterData, runtime: Runtime): RuleStatus[] {
  return cluster.rules.map((r) => {
    const hosts = r.vms.map((vm) => runtime[vm]?.host ?? null);
    if (hosts.some((h) => h === null)) return { vms: r.vms, state: 'not-running' };
    return { vms: r.vms, state: new Set(hosts).size === hosts.length ? 'ok' : 'violated' };
  });
}
