/**
 * The failure simulation: simulate(topology, faults) → what still works, what does not, and why.
 *
 * Pure TypeScript, no UI, no text. Order of evaluation:
 *
 *  1. Power      a device is on if it is not switched off and one of its power sources delivers.
 *                A UPS keeps delivering on battery when the mains is gone.
 *  2. Cluster    hosts that are on and reach the storage carry VMs; VMs of failed hosts are
 *                restarted elsewhere by HA (cluster.ts) if there is room.
 *  3. Links      a link is usable if it is not cut and both ends are on.
 *  4. Tunnels    a VPN tunnel is usable if the WAN link it rides on reaches the internet, the HQ
 *                firewall pair has a running member and HQ itself reaches the internet.
 *  5. Reach      breadth-first search over usable links. Only forwarding devices pass traffic on.
 *                First without backup/degraded links ("up"), then with them ("degraded").
 *                Two kinds of path, which never mix:
 *                  internal  LAN, Wi-Fi, VPN, storage, virtual   (to our own servers)
 *                  external  LAN, Wi-Fi, WAN, virtual            (to internet and cloud services)
 *                So a clinic reaches the PACS only through a tunnel, and the payment provider only
 *                through its own internet line – never the other way round.
 *  6. Needs      every role lists what a device needs (roles.json): services, or another device
 *                ("role:receipt-printer"). A capability is as good as its worst need.
 *  7. Summary    per site (WAN, VPN), per link (also: which backup paths carry traffic now),
 *                chain of events, who is affected, and which safety margins are gone.
 *
 * Blame: to say WHY something fails, the engine looks at the path it would take in a healthy
 * network and finds the first element on it that is broken, then follows that back to a fault.
 */
import type { Device, Link, LinkKind, Role, Service, Topology } from '../schema/topology.schema';
import { placeVms, type ClusterData, type Placement } from './cluster';
import type {
  Affected,
  CapabilityResult,
  Cause,
  ChainEvent,
  DeviceResult,
  Fault,
  LinkResult,
  Quality,
  SimulationResult,
  SiteResult,
  Warning,
} from './types';

export interface SimulationContext {
  roles: Role[];
  cluster: ClusterData;
}

type PathClass = 'internal' | 'external';
const CLASS_KINDS: Record<PathClass, ReadonlySet<LinkKind>> = {
  internal: new Set<LinkKind>(['lan', 'wifi', 'vpn', 'storage', 'virtual']),
  external: new Set<LinkKind>(['lan', 'wifi', 'wan', 'virtual']),
};
const WORSE: Record<Quality, number> = { up: 0, degraded: 1, down: 2 };
const worst = (a: Quality, b: Quality): Quality => (WORSE[a] >= WORSE[b] ? a : b);

interface Edge {
  to: string;
  link: string;
  kind: LinkKind;
  poor: boolean;
}

interface Reach {
  quality: Quality;
  /** Link ids from source to target (empty if unreachable or same device) */
  path: string[];
}

interface NeedResult {
  quality: Quality;
  cause?: Cause;
}

/** Everything that does not depend on the faults. Built once per topology. */
interface Model {
  topo: Topology;
  roles: Map<string, Role>;
  cluster: ClusterData;
  devices: Device[];
  deviceById: Map<string, Device>;
  /** Physical and logical links between live devices, without VM links and without tunnels */
  links: Link[];
  tunnels: Link[];
  services: Map<string, Service>;
  siteKind: Map<string, string>;
  vmHost: Map<string, string>;
  plannedLinks: string[];
  groups: Map<string, string[]>;
  /** Ids of links with role "backup" */
  backupLinks: Set<string>;
  /** Roles that are a site's gateway (its firewall) */
  gatewayRoles: Set<string>;
  /** Tunnel id → the clinic it belongs to */
  tunnelSite: Map<string, string>;
}

function buildModel(topo: Topology, ctx: SimulationContext): Model {
  const live = new Set(topo.sites.filter((s) => s.status !== 'planned').map((s) => s.id));
  const devices = topo.devices.filter((d) => live.has(d.site));
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const links: Link[] = [];
  const tunnels: Link[] = [];
  const plannedLinks: string[] = [];
  const vmHost = new Map(devices.filter((d) => d.runsOn).map((d) => [d.id, d.runsOn!]));
  for (const l of topo.links) {
    if (!deviceById.has(l.a.device) || !deviceById.has(l.b.device)) plannedLinks.push(l.id);
    else if (l.kind === 'vpn') tunnels.push(l);
    else if (vmHost.has(l.a.device) && l.kind === 'virtual') continue; // VM ↔ host follows the placement
    else links.push(l);
  }
  const groups = new Map<string, string[]>();
  for (const d of devices) {
    if (!d.group) continue;
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group)!.push(d.id);
  }
  const siteKind = new Map(topo.sites.map((s) => [s.id, s.kind as string]));
  return {
    topo,
    roles: new Map(ctx.roles.map((r) => [r.id, r])),
    cluster: ctx.cluster,
    devices,
    deviceById,
    links,
    tunnels,
    services: new Map(topo.services.map((s) => [s.id, s])),
    siteKind,
    vmHost,
    plannedLinks,
    groups,
    backupLinks: new Set(topo.links.filter((l) => l.role === 'backup').map((l) => l.id)),
    gatewayRoles: new Set(topo.services.find((s) => s.id === 'gateway')?.providerRoles ?? []),
    tunnelSite: new Map(
      tunnels.map((l) => {
        const ends = [deviceById.get(l.a.device)!, deviceById.get(l.b.device)!];
        return [l.id, (ends.find((d) => siteKind.get(d.site) !== 'hq') ?? ends[0]).site];
      }),
    ),
  };
}

/** The network under one set of faults: who is on, which links work, and how to get from A to B. */
class World {
  readonly on = new Map<string, boolean>();
  readonly offCause = new Map<string, Cause>();
  readonly onBattery = new Set<string>();
  readonly placement = new Map<string, Placement>();
  readonly usable = new Map<string, boolean>();
  readonly poor = new Map<string, boolean>();
  readonly linkCause = new Map<string, Cause>();
  readonly poorCause = new Map<string, Cause>();
  /** Where a tunnel ends at HQ right now (the running member of the firewall pair) */
  readonly tunnelEnds = new Map<string, [string, string]>();
  /** Links that some successful connection actually runs over */
  readonly used = new Set<string>();

  private readonly off = new Map<string, number>();
  private readonly slow = new Map<string, number>();
  private readonly cut = new Map<string, number>();
  private readonly slowLink = new Map<string, number>();
  private readonly serviceFaults: Array<{ index: number; fault: Fault }> = [];
  private adjacency = new Map<string, Edge[]>();
  private bfsCache = new Map<string, Map<string, { prev: string; link: string }>>();

  constructor(
    readonly model: Model,
    readonly faults: Fault[],
    /** The same network without faults; used to find out why something fails */
    readonly healthy?: World,
  ) {
    faults.forEach((fault, index) => {
      const { target } = fault;
      if (target.kind === 'device') {
        if (fault.type === 'power-off') this.off.set(target.id, index);
        else if (fault.type === 'degrade') this.slow.set(target.id, index);
        else if (fault.type === 'service-failure') this.serviceFaults.push({ index, fault });
      } else if (target.kind === 'link') {
        if (fault.type === 'degrade') this.slowLink.set(target.id, index);
        else this.cut.set(target.id, index);
      } else {
        this.serviceFaults.push({ index, fault });
      }
    });
    this.resolvePower();
    this.resolvePhysicalLinks();
    this.resolveCluster();
    this.resolveTunnels();
  }

  // --- 1. Power ------------------------------------------------------------------------------

  private resolvePower() {
    const { model } = this;
    const visit = (id: string): boolean => {
      const known = this.on.get(id);
      if (known !== undefined) return known;
      const d = model.deviceById.get(id);
      if (!d) return false;
      const set = (value: boolean, cause?: Cause) => {
        this.on.set(id, value);
        if (cause) this.offCause.set(id, cause);
        return value;
      };
      const fault = this.off.get(id);
      if (fault !== undefined) return set(false, { fault, reason: 'fault', via: id });
      if (!d.power?.length) return set(true);
      this.on.set(id, false); // guards against cycles while resolving
      const sources = d.power.filter((p) => visit(p));
      if (sources.length > 0) return set(true);
      const root = this.offCause.get(d.power[0]);
      if (model.roles.get(d.role)?.battery) {
        this.onBattery.add(id);
        if (root) this.poorCause.set(id, root);
        return set(true);
      }
      return set(false, { fault: root?.fault ?? -1, reason: 'no-power', via: d.power[0] });
    };
    for (const d of model.devices) if (!model.vmHost.has(d.id)) visit(d.id);
  }

  // --- 3. Links (physical) ------------------------------------------------------------------------

  private addEdge(link: Link, a: string, b: string, poor: boolean) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      if (!this.adjacency.has(from)) this.adjacency.set(from, []);
      this.adjacency.get(from)!.push({ to, link: link.id, kind: link.kind, poor });
    }
    this.bfsCache.clear();
  }

  private deviceCause(id: string): Cause | undefined {
    return this.offCause.get(id);
  }

  private resolvePhysicalLinks() {
    for (const l of this.model.links) {
      const cut = this.cut.get(l.id);
      const endOff = [l.a.device, l.b.device].find((d) => !this.on.get(d));
      const usable = cut === undefined && endOff === undefined;
      this.usable.set(l.id, usable);
      if (cut !== undefined) this.linkCause.set(l.id, { fault: cut, reason: 'fault', via: l.id });
      else if (endOff !== undefined) this.linkCause.set(l.id, this.deviceCause(endOff) ?? { fault: -1, reason: 'no-power', via: endOff });
      if (!usable) continue;

      const slow = this.slowLink.get(l.id) ?? this.slow.get(l.a.device) ?? this.slow.get(l.b.device);
      const poor = l.role === 'backup' || slow !== undefined;
      this.poor.set(l.id, poor);
      if (slow !== undefined) this.poorCause.set(l.id, { fault: slow, reason: 'poor-link', via: l.id });
      this.addEdge(l, l.a.device, l.b.device, poor);
    }
  }

  // --- 2. Cluster --------------------------------------------------------------------------------

  private resolveCluster() {
    const { model } = this;
    const controllers = model.cluster.storage.controllers;
    const hostOk = (h: string) => !!this.on.get(h) && controllers.some((c) => this.on.get(c) && this.reach(h, c, 'internal').quality !== 'down');
    const placed = placeVms(model.cluster, model.vmHost, hostOk);

    for (const [vm, host] of model.vmHost) {
      const p = placed.get(vm) ?? { restarted: false, reason: 'no-host' as const };
      const fault = this.off.get(vm);
      if (fault !== undefined) {
        this.on.set(vm, false);
        this.offCause.set(vm, { fault, reason: 'fault', via: vm });
        continue;
      }
      this.placement.set(vm, p);
      this.on.set(vm, p.host !== undefined);
      // Why the VM is not where it started: its host is off, or the host lost its storage
      const hostCause = this.offCause.get(host);
      const storageCause = this.on.get(host) ? this.firstCause(controllers) : undefined;
      const root = hostCause ?? storageCause;
      if (p.host === undefined) {
        this.offCause.set(vm, { fault: root?.fault ?? -1, reason: p.reason === 'no-capacity' ? 'no-capacity' : hostCause ? 'host-down' : 'no-storage', via: host });
      } else {
        if (p.restarted) this.poorCause.set(vm, { fault: root?.fault ?? -1, reason: 'restarted', via: host });
        const slow = this.slow.get(vm) ?? this.slow.get(p.host);
        this.addEdge({ id: `virt-${vm}`, a: { device: vm }, b: { device: p.host }, kind: 'virtual', medium: 'virtual' }, vm, p.host, slow !== undefined);
        this.usable.set(`virt-${vm}`, true);
      }
    }
    for (const [vm] of model.vmHost) if (!this.on.get(vm)) this.usable.set(`virt-${vm}`, false);
  }

  private firstCause(ids: string[]): Cause | undefined {
    for (const id of ids) {
      const c = this.offCause.get(id);
      if (c) return c;
    }
    return undefined;
  }

  // --- 4. Tunnels --------------------------------------------------------------------------------

  private resolveTunnels() {
    const { model } = this;
    for (const l of model.tunnels) {
      const aIsHq = model.siteKind.get(model.deviceById.get(l.a.device)!.site) === 'hq';
      const clinicFw = aIsHq ? l.b.device : l.a.device;
      const hqEnd = aIsHq ? l.a.device : l.b.device;
      const site = model.tunnelSite.get(l.id)!;
      const members = model.groups.get(model.deviceById.get(hqEnd)?.group ?? '') ?? [hqEnd];
      const hqFw = [hqEnd, ...members].find((m) => this.on.get(m));
      const via = l.via ? model.topo.links.find((x) => x.id === l.via) : undefined;
      const fail = (cause: Cause | undefined) => {
        this.usable.set(l.id, false);
        this.linkCause.set(l.id, cause ?? { fault: -1, reason: 'unreachable', via: l.id });
      };

      const cut = this.cut.get(l.id);
      const tunnelFault = this.serviceFaults.find((s) => s.fault.target.kind === 'service' && s.fault.target.id === 'vpn' && (!s.fault.target.site || s.fault.target.site === site));
      if (cut !== undefined) {
        fail({ fault: cut, reason: 'fault', via: l.id });
        continue;
      }
      if (tunnelFault) {
        fail({ fault: tunnelFault.index, reason: 'service-down', via: l.id });
        continue;
      }
      if (!this.on.get(clinicFw)) {
        fail(this.deviceCause(clinicFw));
        continue;
      }
      if (!via || !this.usable.get(via.id)) {
        fail(via ? this.linkCause.get(via.id) : undefined);
        continue;
      }
      // Underlay on the clinic side: from the provider at the far end of the WAN link to the internet
      const provider = via.a.device === clinicFw ? via.b.device : via.a.device;
      const clinicSide = this.reach(provider, 'internet', 'external');
      if (clinicSide.quality === 'down') {
        fail(this.blame(provider, 'internet', 'external'));
        continue;
      }
      if (!hqFw) {
        fail(this.deviceCause(hqEnd));
        continue;
      }
      const hqSide = this.best(members.filter((m) => this.on.get(m)).map((m) => this.reach(m, 'internet', 'external')));
      if (hqSide.quality === 'down') {
        fail(this.blame(hqEnd, 'internet', 'external'));
        continue;
      }

      const slow = this.slowLink.get(l.id) ?? this.slowLink.get(via.id) ?? this.slow.get(clinicFw);
      const poor = l.role === 'backup' || slow !== undefined || hqSide.quality === 'degraded';
      this.usable.set(l.id, true);
      this.poor.set(l.id, poor);
      if (slow !== undefined) this.poorCause.set(l.id, { fault: slow, reason: 'poor-link', via: l.id });
      else if (hqSide.quality === 'degraded') {
        const why = this.healthy?.blameAgainst(this, hqFw, 'internet', 'external');
        this.poorCause.set(l.id, { fault: why?.fault ?? -1, reason: 'backup-path', via: why?.via });
        hqSide.path.forEach((id) => this.used.add(id));
      }
      this.tunnelEnds.set(l.id, [clinicFw, hqFw]);
      this.addEdge(l, clinicFw, hqFw, poor);
    }
  }

  // --- 5. Reach ----------------------------------------------------------------------------------

  private best(list: Reach[]): Reach {
    return list.reduce((a, b) => (WORSE[b.quality] < WORSE[a.quality] ? b : a), { quality: 'down', path: [] } as Reach);
  }

  private forwards(id: string): boolean {
    const d = this.model.deviceById.get(id);
    return !!d && !!this.model.roles.get(d.role)?.forwards;
  }

  private search(from: string, cls: PathClass, allowPoor: boolean) {
    const key = `${from}|${cls}|${allowPoor}`;
    const cached = this.bfsCache.get(key);
    if (cached) return cached;
    const prev = new Map<string, { prev: string; link: string }>();
    const seen = new Set([from]);
    const queue = [from];
    const kinds = CLASS_KINDS[cls];
    while (queue.length) {
      const cur = queue.shift()!;
      // Endpoints are never a way through: a laptop on two access points is not a bridge
      if (cur !== from && !this.forwards(cur)) continue;
      for (const e of this.adjacency.get(cur) ?? []) {
        if (seen.has(e.to) || !kinds.has(e.kind) || (e.poor && !allowPoor)) continue;
        seen.add(e.to);
        prev.set(e.to, { prev: cur, link: e.link });
        queue.push(e.to);
      }
    }
    this.bfsCache.set(key, prev);
    return prev;
  }

  private pathFrom(prev: Map<string, { prev: string; link: string }>, from: string, to: string): string[] {
    const path: string[] = [];
    for (let cur = to; cur !== from; ) {
      const step = prev.get(cur)!;
      path.unshift(step.link);
      cur = step.prev;
    }
    return path;
  }

  /** How well `from` reaches `to`: up (clean path), degraded (only over backup or slow links), down. */
  reach(from: string, to: string, cls: PathClass): Reach {
    if (!this.on.get(from) || !this.on.get(to)) return { quality: 'down', path: [] };
    if (from === to) return { quality: 'up', path: [] };
    const clean = this.search(from, cls, false);
    if (clean.has(to)) return { quality: 'up', path: this.pathFrom(clean, from, to) };
    const any = this.search(from, cls, true);
    if (any.has(to)) return { quality: 'degraded', path: this.pathFrom(any, from, to) };
    return { quality: 'down', path: [] };
  }

  // --- Blame -------------------------------------------------------------------------------------

  /**
   * Called on the healthy world: take the path from → to that works here and return the cause of
   * the first link on it that does not work (or is degraded) in `broken`.
   */
  blameAgainst(broken: World, from: string, to: string, cls: PathClass): Cause | undefined {
    for (const id of this.reach(from, to, cls).path) {
      if (!broken.usable.get(id)) return broken.linkCause.get(id) ?? { fault: -1, reason: 'unreachable', via: id };
    }
    for (const id of this.reach(from, to, cls).path) {
      const c = broken.poorCause.get(id);
      if (c) return c;
    }
    return undefined;
  }

  private blame(from: string, to: string, cls: PathClass): Cause | undefined {
    if (!this.on.get(to)) return this.deviceCause(to);
    return this.healthy?.blameAgainst(this, from, to, cls);
  }

  // --- 6. Needs ----------------------------------------------------------------------------------

  private classFor(provider: Device): PathClass {
    return this.model.siteKind.get(provider.site) === 'external' ? 'external' : 'internal';
  }

  /** One provider as seen from one device. */
  private viaProvider(d: Device, provider: Device): NeedResult {
    if (!this.on.get(provider.id)) return { quality: 'down', cause: this.deviceCause(provider.id) };
    const cls = this.classFor(provider);
    const r = this.reach(d.id, provider.id, cls);
    if (r.quality === 'down') return { quality: 'down', cause: this.blame(d.id, provider.id, cls) ?? { fault: -1, reason: 'unreachable' } };
    r.path.forEach((id) => this.used.add(id));
    if (r.quality === 'degraded') {
      const why = this.blame(d.id, provider.id, cls) ?? r.path.map((id) => this.poorCause.get(id)).find(Boolean);
      const reason = why?.reason === 'poor-link' || why?.reason === 'backup-path' ? why.reason : 'backup-path';
      return { quality: 'degraded', cause: { fault: why?.fault ?? -1, reason, via: why?.via } };
    }
    const restarted = this.placement.get(provider.id)?.restarted ? this.poorCause.get(provider.id) : undefined;
    if (restarted) return { quality: 'degraded', cause: restarted };
    return { quality: 'up' };
  }

  private combine(results: NeedResult[], redundancy: 'any' | 'all'): NeedResult {
    if (results.length === 0) return { quality: 'down', cause: { fault: -1, reason: 'service-down' } };
    const pick = (cmp: (a: number, b: number) => boolean) => results.reduce((a, b) => (cmp(WORSE[b.quality], WORSE[a.quality]) ? b : a));
    return redundancy === 'any' ? pick((b, a) => b < a) : pick((b, a) => b > a);
  }

  need(d: Device, need: string): NeedResult {
    const { model } = this;
    if (need.startsWith('role:')) {
      const role = need.slice(5);
      const all = model.devices.filter((x) => x.role === role);
      const local = all.filter((x) => x.site === d.site);
      return this.combine((local.length ? local : all).map((p) => this.viaProvider(d, p)), 'any');
    }
    const service = model.services.get(need);
    if (!service) return { quality: 'down', cause: { fault: -1, reason: 'service-down' } };

    // The service as a whole fails for this device (pool empty, certificate expired, ...)
    const whole = this.serviceFaults.find(({ fault }) => {
      const t = fault.target;
      return t.kind === 'service' && t.id === need && (!t.site || t.site === d.site) && (t.vlan === undefined || t.vlan === d.vlan);
    });
    if (whole) return { quality: 'down', cause: { fault: whole.index, reason: 'service-down', via: need } };
    if (need === 'dhcp' && !d.dhcp) return { quality: 'up' };

    const providers = service.scope === 'global' ? (service.providers ?? []).map((id) => model.deviceById.get(id)).filter((p): p is Device => !!p) : model.devices.filter((p) => p.site === d.site && service.providerRoles?.includes(p.role));
    const results = providers.map((p) => {
      // One provider stopped serving it (the device itself is still on)
      const stopped = this.serviceFaults.find(({ fault }) => fault.target.kind === 'device' && fault.target.id === p.id && (!fault.service || fault.service === need));
      if (stopped) return { quality: 'down' as Quality, cause: { fault: stopped.index, reason: 'service-down' as const, via: p.id } };
      return this.viaProvider(d, p);
    });
    return this.combine(results, service.redundancy);
  }

  /** Providers of a global service that do not serve it right now (for the redundancy warning). */
  missingProviders(service: Service): string[] {
    return (service.providers ?? []).filter(
      (id) => !this.on.get(id) || this.serviceFaults.some(({ fault }) => fault.target.kind === 'device' && fault.target.id === id && (!fault.service || fault.service === service.id)),
    );
  }

  isSlow(id: string): number | undefined {
    return this.slow.get(id);
  }
}

// ---------------------------------------------------------------------------------------------

const models = new WeakMap<Topology, { model: Model; healthy: World; baseline: SimulationResult }>();

function summarize(world: World, baseline?: SimulationResult): SimulationResult {
  const { model, faults } = world;
  const devices: Record<string, DeviceResult> = {};
  const capabilities: CapabilityResult[] = [];

  // Capabilities, device by device
  for (const d of model.devices) {
    const role = model.roles.get(d.role);
    const on = !!world.on.get(d.id);
    const placement = world.placement.get(d.id);
    const result: DeviceResult = { on, state: on ? 'up' : 'down' };
    if (!on) result.cause = world.offCause.get(d.id);
    if (placement?.host) result.host = placement.host;
    if (placement?.restarted) {
      result.restarted = true;
      result.state = 'degraded';
      result.cause = world.poorCause.get(d.id);
    }
    if (world.onBattery.has(d.id)) {
      result.onBattery = true;
      result.state = 'degraded';
      result.cause = world.poorCause.get(d.id);
    }
    const slow = world.isSlow(d.id);
    if (on && slow !== undefined) {
      result.state = 'degraded';
      result.cause = { fault: slow, reason: 'fault', via: d.id };
    }

    if (role) {
      let base: NeedResult & { need?: string } = { quality: 'up' };
      if (on) {
        for (const n of role.needs) {
          const r = world.need(d, n);
          if (WORSE[r.quality] > WORSE[base.quality]) base = { ...r, need: n };
        }
        if (slow !== undefined && base.quality === 'up') base = { quality: 'degraded', cause: { fault: slow, reason: 'fault', via: d.id } };
      }
      for (const cap of role.capabilities) {
        let state: NeedResult & { need?: string } = on ? base : { quality: 'down', cause: world.offCause.get(d.id) };
        if (on && base.quality !== 'down') {
          for (const n of cap.needs) {
            const r = world.need(d, n);
            if (WORSE[r.quality] > WORSE[state.quality]) state = { ...r, need: n };
          }
        }
        const offNetwork = state.need !== undefined && role.needs.includes(state.need) ? true : undefined;
        capabilities.push({ device: d.id, site: d.site, role: d.role, capability: cap.id, audience: cap.audience, state: state.quality, need: state.need, offNetwork, cause: state.cause });
        if (on) result.state = worst(result.state, state.quality);
      }
      // A device with no capabilities of its own still has to be on the network
      if (on && role.capabilities.length === 0 && base.quality !== 'up') {
        result.state = worst(result.state, base.quality);
        result.cause ??= base.cause;
      }
      if (on && result.state !== 'up' && !result.cause) {
        result.cause = capabilities.filter((c) => c.device === d.id && c.state === result.state)[0]?.cause;
      }
    }
    devices[d.id] = result;
  }

  // Sites
  const sites: Record<string, SiteResult> = {};
  const hqFirewalls = model.devices.filter((d) => model.siteKind.get(d.site) === 'hq' && model.gatewayRoles.has(d.role));
  for (const site of model.topo.sites) {
    if (site.kind === 'external' || site.status === 'planned') continue;
    const firewalls = model.devices.filter((d) => d.site === site.id && model.gatewayRoles.has(d.role));
    const pick = (targets: string[], cls: PathClass) => {
      let bestQ: Quality = 'down';
      let path: string[] = [];
      for (const fw of firewalls) {
        for (const t of targets) {
          const r = world.reach(fw.id, t, cls);
          if (WORSE[r.quality] < WORSE[bestQ] || (bestQ === 'down' && r.quality !== 'down')) {
            bestQ = r.quality;
            path = r.path;
          }
        }
      }
      path.forEach((id) => world.used.add(id));
      // "backup" only if the path really runs over a backup link; a slow primary line is still primary
      const overBackup = path.some((id) => model.backupLinks.has(id));
      return { quality: bestQ, overBackup };
    };
    const wan = pick(['internet'], 'external');
    const result: SiteResult = { wan: wan.quality === 'down' ? 'offline' : wan.overBackup ? 'backup' : 'primary', state: wan.quality };
    if (site.kind === 'clinic') {
      const vpn = pick(hqFirewalls.map((f) => f.id), 'internal');
      result.vpn = vpn.quality === 'down' ? 'down' : vpn.overBackup ? 'backup' : 'primary';
      result.state = worst(wan.quality, vpn.quality);
    }
    sites[site.id] = result;
  }

  // Links
  const links: Record<string, LinkResult> = {};
  for (const id of model.plannedLinks) links[id] = { state: 'planned', carrying: false };
  for (const l of [...model.links, ...model.tunnels]) {
    const usable = !!world.usable.get(l.id);
    const carrying = world.used.has(l.id);
    if (!usable) links[l.id] = { state: 'down', carrying: false, cause: world.linkCause.get(l.id) };
    else if (l.role === 'backup') links[l.id] = { state: carrying ? 'degraded' : 'standby', carrying, cause: carrying ? world.poorCause.get(l.id) : undefined };
    else links[l.id] = { state: world.poor.get(l.id) ? 'degraded' : 'up', carrying, cause: world.poorCause.get(l.id) };
  }
  for (const [vm] of model.vmHost) links[`virt-${vm}`] = { state: world.usable.get(`virt-${vm}`) ? 'up' : 'down', carrying: false, cause: world.offCause.get(vm) };

  // Who is affected: capabilities that do not work, grouped
  const groups = new Map<string, Affected>();
  for (const c of capabilities) {
    if (c.state === 'up') continue;
    const key = [c.site, c.audience, c.role, c.capability, c.state, c.need ?? ''].join('|');
    const g = groups.get(key);
    if (g) g.devices.push(c.device);
    else groups.set(key, { site: c.site, audience: c.audience, capability: c.capability, role: c.role, state: c.state, devices: [c.device], need: c.need, offNetwork: c.offNetwork, cause: c.cause });
  }
  const affected = [...groups.values()].sort((a, b) => WORSE[b.state] - WORSE[a.state] || a.site.localeCompare(b.site) || a.audience.localeCompare(b.audience));

  // Warnings: safety margins that are gone
  const warnings: Warning[] = [];
  for (const [group, members] of model.groups) {
    const missing = members.filter((m) => !world.on.get(m));
    if (missing.length > 0 && missing.length < members.length) warnings.push({ kind: 'redundancy-lost', subject: group, missing });
  }
  const hostsDown = model.cluster.hosts.filter((h) => !world.on.get(h.id)).map((h) => h.id);
  if (hostsDown.length > 0 && hostsDown.length < model.cluster.hosts.length) warnings.push({ kind: 'capacity-reserve-used', subject: 'cluster', missing: hostsDown });
  for (const id of world.onBattery) warnings.push({ kind: 'on-battery', subject: id, missing: model.deviceById.get(id)?.power ?? [] });
  for (const s of model.services.values()) {
    if (s.scope !== 'global' || (s.providers?.length ?? 0) < 2) continue;
    const missing = world.missingProviders(s);
    if (missing.length > 0 && missing.length < s.providers!.length) warnings.push({ kind: 'service-redundancy-lost', subject: s.id, missing });
  }

  // Chain of events, in the order things happen
  const chain: ChainEvent[] = faults.map((f, i) => ({ kind: 'fault', subject: f.target.id, site: f.target.kind === 'device' ? model.deviceById.get(f.target.id)?.site : undefined, params: {}, fault: i }));
  const faulted = new Set(faults.filter((f) => f.target.kind === 'device').map((f) => f.target.id));
  for (const d of model.devices) {
    const r = devices[d.id];
    if (model.vmHost.has(d.id)) continue;
    if (!r.on && !faulted.has(d.id)) chain.push({ kind: 'power-lost', subject: d.id, site: d.site, params: { source: r.cause?.via ?? '' }, fault: r.cause?.fault ?? -1 });
  }
  for (const id of world.onBattery) chain.push({ kind: 'on-battery', subject: id, site: model.deviceById.get(id)?.site, params: {}, fault: world.poorCause.get(id)?.fault ?? -1 });
  for (const [vm, from] of model.vmHost) {
    const r = devices[vm];
    if (r.restarted) chain.push({ kind: 'vm-restarted', subject: vm, site: 'hq', params: { from, to: r.host ?? '' }, fault: r.cause?.fault ?? -1 });
    else if (!r.on && !faulted.has(vm)) chain.push({ kind: 'vm-down', subject: vm, site: 'hq', params: { from, reason: r.cause?.reason ?? '' }, fault: r.cause?.fault ?? -1 });
  }
  const tunnelFault = (site: string) => {
    const down = model.tunnels.filter((l) => model.tunnelSite.get(l.id) === site && links[l.id].state === 'down').map((l) => links[l.id].cause?.fault ?? -1);
    return down.find((f) => f >= 0) ?? -1;
  };
  for (const [id, s] of Object.entries(sites)) {
    const before = baseline?.sites[id];
    if (before && s.wan !== before.wan) {
      const wanLinks = model.links.filter((l) => l.kind === 'wan' && [l.a.device, l.b.device].some((d) => model.deviceById.get(d)?.site === id));
      const fault = wanLinks.map((l) => links[l.id]).find((l) => l.state === 'down')?.cause?.fault ?? -1;
      chain.push({ kind: s.wan === 'offline' ? 'site-offline' : 'wan-failover', subject: id, site: id, params: {}, fault });
    }
    if (before && s.vpn && s.vpn !== before.vpn) {
      const poor = model.tunnels.filter((l) => model.tunnelSite.get(l.id) === id).map((l) => links[l.id].cause?.fault ?? -1).find((f) => f >= 0) ?? -1;
      chain.push({ kind: s.vpn === 'down' ? 'vpn-down' : 'vpn-failover', subject: id, site: id, params: {}, fault: s.vpn === 'down' ? tunnelFault(id) : poor });
    }
  }
  for (const l of model.links) {
    if (l.kind !== 'wifi' || l.role !== 'backup' || !links[l.id].carrying) continue;
    const client = model.deviceById.get(l.b.device)?.role === 'access-point' ? l.a.device : l.b.device;
    const ap = client === l.a.device ? l.b.device : l.a.device;
    chain.push({ kind: 'roaming', subject: client, site: model.deviceById.get(client)?.site, params: { ap }, fault: -1 });
  }
  const gateways = new Map<string, string[]>();
  for (const d of model.devices) {
    if (!model.gatewayRoles.has(d.role)) continue;
    if (!gateways.has(d.site)) gateways.set(d.site, []);
    gateways.get(d.site)!.push(d.id);
  }
  const cutOffCache = new Map<string, boolean>();
  /** The device cannot even reach its own site's firewall */
  const cutOff = (id: string) => {
    if (cutOffCache.has(id)) return cutOffCache.get(id)!;
    const d = model.deviceById.get(id)!;
    const gws = gateways.get(d.site) ?? [];
    const value = gws.length > 0 && !gws.includes(id) && !gws.some((g) => world.reach(id, g, 'internal').quality !== 'down');
    cutOffCache.set(id, value);
    return value;
  };
  const seen = new Set<string>();
  for (const c of [...capabilities].sort((a, b) => WORSE[b.state] - WORSE[a.state])) {
    if (c.state === 'up' || !c.need || c.need.startsWith('role:')) continue;
    // A device that fell off the network did not lose "DHCP": the service is fine, the device is cut off
    if (c.offNetwork && c.cause?.reason !== 'service-down') continue;
    if (cutOff(c.device)) continue;
    const key = `${c.site}|${c.need}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chain.push({ kind: c.state === 'down' ? 'service-down' : 'service-degraded', subject: c.need, site: c.site, params: { reason: c.cause?.reason ?? '' }, fault: c.cause?.fault ?? -1 });
  }

  const healthy = affected.length === 0 && warnings.length === 0 && chain.length === faults.length;
  return { faults, devices, links, capabilities, sites, chain, affected, warnings, healthy };
}

/**
 * Runs the simulation. `faults` may be empty (the healthy network) and may contain any number of
 * simultaneous faults; they combine the way they would in reality.
 */
export function simulate(topology: Topology, faults: Fault[], ctx: SimulationContext): SimulationResult {
  let cached = models.get(topology);
  if (!cached) {
    const model = buildModel(topology, ctx);
    const healthy = new World(model, []);
    cached = { model, healthy, baseline: summarize(healthy) };
    models.set(topology, cached);
  }
  if (faults.length === 0) return cached.baseline;
  return summarize(new World(cached.model, faults, cached.healthy), cached.baseline);
}
