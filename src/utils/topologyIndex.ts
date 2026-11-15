/**
 * Derived lookups built once from the expanded topology:
 * id → object maps, devices per site/zone, neighbours, service providers, dependents.
 */
import type { Device, Link, Role, Service, Site, Topology, Vlan, Zone } from '../schema/topology.schema';
import { subnetOf } from './ip';

export interface Neighbor {
  device: Device;
  link: Link;
  /** Port on this device's side / on the other side */
  port?: string;
  remotePort?: string;
}

export interface TopologyIndex {
  topology: Topology;
  sites: Map<string, Site>;
  zones: Map<string, Zone>;
  devices: Map<string, Device>;
  links: Map<string, Link>;
  vlans: Map<number, Vlan>;
  roles: Map<string, Role>;
  services: Map<string, Service>;
  devicesOfSite: (siteId: string) => Device[];
  zonesOfSite: (siteId: string) => Zone[];
  neighbors: (deviceId: string) => Neighbor[];
  /** Devices that provide a service for a device in this site */
  providersOf: (serviceId: string, siteId: string) => Device[];
  /** Services this device provides */
  providedBy: (deviceId: string) => Service[];
  /** Devices that stop working (fully or partly) without this one: powered by it, attached to it, or using its services */
  dependentsOf: (deviceId: string) => Device[];
  /** "10.2.20.0/24" for a device with a VLAN, otherwise undefined */
  subnetOfDevice: (device: Device) => string | undefined;
}

/** All services a role needs, for being online and for each thing people do with it ("role:..." needs left out). */
export function serviceNeeds(role: Role | undefined): string[] {
  if (!role) return [];
  const all = [...role.needs, ...role.capabilities.flatMap((c) => c.needs)].filter((n) => !n.startsWith('role:'));
  return [...new Set(all)];
}

/** Roles that pass traffic on; an endpoint attached to them depends on them. */
const FORWARDING_ROLES = new Set(['clinic-firewall', 'hq-firewall', 'access-switch', 'core-switch', 'access-point', 'esxi-host', 'isp', 'mobile-network', 'cloud-lb']);

export function buildIndex(topology: Topology, roleList: Role[]): TopologyIndex {
  const sites = new Map(topology.sites.map((s) => [s.id, s]));
  const zones = new Map(topology.zones.map((z) => [z.id, z]));
  const devices = new Map(topology.devices.map((d) => [d.id, d]));
  const links = new Map(topology.links.map((l) => [l.id, l]));
  const vlans = new Map(topology.vlans.map((v) => [v.id, v]));
  const roles = new Map(roleList.map((r) => [r.id, r]));
  const services = new Map(topology.services.map((s) => [s.id, s]));

  const bySite = new Map<string, Device[]>();
  for (const d of topology.devices) {
    if (!bySite.has(d.site)) bySite.set(d.site, []);
    bySite.get(d.site)!.push(d);
  }

  const adjacency = new Map<string, Neighbor[]>(topology.devices.map((d) => [d.id, []]));
  for (const l of topology.links) {
    const a = devices.get(l.a.device);
    const b = devices.get(l.b.device);
    if (!a || !b) continue;
    adjacency.get(a.id)!.push({ device: b, link: l, port: l.a.port, remotePort: l.b.port });
    adjacency.get(b.id)!.push({ device: a, link: l, port: l.b.port, remotePort: l.a.port });
  }

  const providersOf = (serviceId: string, siteId: string): Device[] => {
    const s = services.get(serviceId);
    if (!s) return [];
    if (s.scope === 'global') return (s.providers ?? []).map((id) => devices.get(id)).filter((d): d is Device => !!d);
    return (bySite.get(siteId) ?? []).filter((d) => s.providerRoles?.includes(d.role));
  };

  const providedBy = (deviceId: string): Service[] => {
    const d = devices.get(deviceId);
    if (!d) return [];
    return topology.services.filter((s) => (s.scope === 'global' ? s.providers?.includes(d.id) : s.providerRoles?.includes(d.role)));
  };

  const dependentsOf = (deviceId: string): Device[] => {
    const self = devices.get(deviceId);
    if (!self) return [];
    const out = new Map<string, Device>();
    const provided = new Set(providedBy(deviceId).map((s) => s.id));
    for (const d of topology.devices) {
      if (d.id === deviceId) continue;
      if (d.power?.includes(deviceId)) out.set(d.id, d);
      const needs = serviceNeeds(roles.get(d.role));
      const sameScope = (s: string) => services.get(s)?.scope === 'global' || d.site === self.site;
      if (needs.some((s) => provided.has(s) && sameScope(s))) out.set(d.id, d);
    }
    if (FORWARDING_ROLES.has(self.role)) {
      for (const n of adjacency.get(deviceId) ?? []) {
        // Only what hangs below: endpoints, servers and access points – not the uplink
        const layer = roles.get(n.device.role)?.layer;
        if (layer === 'endpoint' || layer === 'server' || (n.device.role === 'access-point' && self.role !== 'access-point')) out.set(n.device.id, n.device);
      }
    }
    return [...out.values()];
  };

  return {
    topology,
    sites,
    zones,
    devices,
    links,
    vlans,
    roles,
    services,
    devicesOfSite: (id) => bySite.get(id) ?? [],
    zonesOfSite: (id) => topology.zones.filter((z) => z.site === id),
    neighbors: (id) => adjacency.get(id) ?? [],
    providersOf,
    providedBy,
    dependentsOf,
    subnetOfDevice: (d) => {
      const n = sites.get(d.site)?.number;
      return n !== undefined && d.vlan !== undefined ? subnetOf(n, d.vlan) : undefined;
    },
  };
}
