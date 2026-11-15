/**
 * Validates topology.json and roles.json.
 *
 * Three stages:
 *  1) zod: field formats (enums, VLAN range, required fields)
 *  2) template expansion
 *  3) cross-references on the expanded result: do referenced devices, zones, roles exist?
 *     does every IP fit 10.<site>.<vlan>.0/24? is every address unique?
 *
 * Nothing here throws – problems are returned as a list. Also returns every translation key the
 * data needs, so the caller can check them against the dictionaries.
 */
import type { ZodIssue } from 'zod';
import { expandTopology } from './expandTopology';
import { rolesSchema, topologySchema, type Role, type Topology } from './topology.schema';
import type { Issue } from './validateI18n';
import { inSubnet, isValidIPv4 } from '../utils/ip';
import { clusterSchema, placeVms, type ClusterData } from '../engine/cluster';

export interface DataValidation {
  ok: boolean;
  issues: Issue[];
  topology?: Topology;
  roles?: Role[];
  cluster?: ClusterData;
  /** Translation keys used by the data, with the place that uses them */
  keys: Array<{ key: string; where: string }>;
}

const STRICT_ID = /^[A-Za-z0-9._-]+$/;
const zodIssues = (file: string, list: ZodIssue[]): Issue[] =>
  list.map((i) => ({ severity: 'error', path: `${file} › ${i.path.join(' › ') || '(root)'}`, message: i.message }));

export function validateData(rawTopology: unknown, rawRoles: unknown, rawCluster?: unknown): DataValidation {
  const issues: Issue[] = [];
  const keys: DataValidation['keys'] = [];
  const err = (path: string, message: string) => issues.push({ severity: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ severity: 'warning', path, message });
  const needKey = (key: string, where: string) => keys.push({ key, where });

  const parsedRoles = rolesSchema.safeParse(rawRoles);
  const parsedTopo = topologySchema.safeParse(rawTopology);
  if (!parsedRoles.success) issues.push(...zodIssues('roles.json', parsedRoles.error.issues));
  if (!parsedTopo.success) issues.push(...zodIssues('topology.json', parsedTopo.error.issues));
  if (!parsedRoles.success || !parsedTopo.success) return { ok: false, issues, keys };

  const roles = parsedRoles.data.roles;
  const raw = parsedTopo.data;
  const topo = expandTopology(raw);

  // --- Unique, well-formed ids ---------------------------------------------------------
  const unique = <T>(list: T[], id: (x: T) => string | number, what: string) => {
    const seen = new Set<string | number>();
    for (const item of list) {
      const k = id(item);
      if (typeof k === 'string' && !STRICT_ID.test(k)) err(`${what} "${k}"`, 'Id contains an unresolved placeholder or an invalid character');
      if (seen.has(k)) err(`${what} "${k}"`, 'Id is used more than once (after template expansion)');
      seen.add(k);
    }
    return seen;
  };
  const roleIds = unique(roles, (r) => r.id, 'role');
  const vlanIds = unique(topo.vlans, (v) => v.id, 'vlan');
  const siteIds = unique(topo.sites, (s) => s.id, 'site');
  unique(topo.zones, (z) => z.id, 'zone');
  const deviceIds = unique(topo.devices, (d) => d.id, 'device');
  unique(topo.links, (l) => l.id, 'link');
  const serviceIds = unique(topo.services, (s) => s.id, 'service');
  unique(topo.accessPolicy.rules, (r) => r.id, 'rule');

  const siteById = new Map(topo.sites.map((s) => [s.id, s]));
  const zoneById = new Map(topo.zones.map((z) => [z.id, z]));
  const vlanById = new Map(topo.vlans.map((v) => [v.id, v]));
  const deviceById = new Map(topo.devices.map((d) => [d.id, d]));
  const linkById = new Map(topo.links.map((l) => [l.id, l]));

  // --- Roles ------------------------------------------------------------------------------
  for (const r of roles) {
    const checkNeed = (need: string, where: string) => {
      if (need.startsWith('role:')) {
        if (!roleIds.has(need.slice(5))) err(where, `Role "${need.slice(5)}" is not defined`);
      } else if (!serviceIds.has(need)) err(where, `Service "${need}" is not defined`);
    };
    r.needs.forEach((n) => checkNeed(n, `role "${r.id}" › needs`));
    const capIds = new Set<string>();
    for (const c of r.capabilities) {
      if (capIds.has(c.id)) err(`role "${r.id}" › capabilities`, `Capability "${c.id}" is listed twice`);
      capIds.add(c.id);
      c.needs.forEach((n) => checkNeed(n, `role "${r.id}" › capability "${c.id}"`));
    }
    for (const suffix of ['label', 'simple', 'technical']) needKey(`roles.${r.id}.${suffix}`, `role "${r.id}"`);
  }

  // --- VLANs, services (texts by convention) ----------------------------------------------
  for (const v of topo.vlans) {
    needKey(`topology.vlan.${v.id}.label`, `vlan ${v.id}`);
    needKey(`topology.vlan.${v.id}.purpose`, `vlan ${v.id}`);
  }
  for (const s of topo.services) needKey(`topology.service.${s.id}`, `service "${s.id}"`);

  // --- Sites ------------------------------------------------------------------------------
  const numbers = new Map<number, string>();
  for (const s of topo.sites) {
    needKey(`topology.site.${s.id}.label`, `site "${s.id}"`);
    needKey(`topology.site.${s.id}.simple`, `site "${s.id}"`);
    needKey(`topology.site.${s.id}.technical`, `site "${s.id}"`);
    if (s.template && !raw.templates[s.template]) err(`site "${s.id}" › template`, `Template "${s.template}" is not defined`);
    if (s.kind !== 'external') {
      if (s.number === undefined) err(`site "${s.id}" › number`, 'Sites of kind hq/clinic need a number (second octet)');
      else if (numbers.has(s.number)) err(`site "${s.id}" › number`, `Number ${s.number} is already used by "${numbers.get(s.number)}"`);
      else numbers.set(s.number, s.id);
    }
  }

  // --- Zones ------------------------------------------------------------------------------
  for (const z of topo.zones) {
    if (!siteIds.has(z.site)) err(`zone "${z.id}" › site`, `Site "${z.site}" is not defined`);
    needKey(z.labelKey, `zone "${z.id}"`);
  }

  // --- Devices ----------------------------------------------------------------------------
  const ipOwner = new Map<string, string>();
  for (const d of topo.devices) {
    const at = `device "${d.id}"`;
    const site = siteById.get(d.site);
    if (!site) err(`${at} › site`, `Site "${d.site}" is not defined`);
    const zone = zoneById.get(d.zone);
    if (!zone) err(`${at} › zone`, `Zone "${d.zone}" is not defined`);
    else if (zone.site !== d.site) err(`${at} › zone`, `Zone "${d.zone}" belongs to site "${zone.site}", the device to "${d.site}"`);
    if (!roleIds.has(d.role)) err(`${at} › role`, `Role "${d.role}" is not defined in roles.json`);
    if (d.noteKey) needKey(d.noteKey, at);

    const vlan = d.vlan !== undefined ? vlanById.get(d.vlan) : undefined;
    if (d.vlan !== undefined && !vlan) err(`${at} › vlan`, `VLAN ${d.vlan} is not defined`);
    if (vlan?.scope === 'hq' && site && site.kind !== 'hq') err(`${at} › vlan`, `VLAN ${vlan.id} exists only at HQ`);
    if (d.ip && d.dhcp) err(`${at} › ip`, 'A device has either a static "ip" or "dhcp": true, not both');
    if ((d.ip || d.dhcp) && d.vlan === undefined) err(`${at} › vlan`, 'A device with an address needs a VLAN');
    if (d.dhcp && vlan && !vlan.dhcp) err(`${at} › dhcp`, `VLAN ${vlan.id} has no DHCP pool`);
    if (d.ip) {
      if (!isValidIPv4(d.ip)) err(`${at} › ip`, `"${d.ip}" is not a valid IPv4 address`);
      else if (site?.number !== undefined && d.vlan !== undefined && !inSubnet(d.ip, site.number, d.vlan))
        err(`${at} › ip`, `${d.ip} is outside 10.${site.number}.${d.vlan}.0/24`);
      const owner = ipOwner.get(d.ip);
      if (owner) err(`${at} › ip`, `${d.ip} is also used by "${owner}"`);
      else ipOwner.set(d.ip, d.id);
    }

    for (const p of d.power ?? []) {
      if (!deviceIds.has(p)) err(`${at} › power`, `Power source "${p}" is not a device`);
      else if (p === d.id) err(`${at} › power`, 'A device cannot power itself');
    }
    if (d.runsOn && deviceById.get(d.runsOn)?.role !== 'esxi-host') err(`${at} › runsOn`, `"${d.runsOn}" is not an ESXi host`);
    if (d.group && !d.groupMode) warn(`${at} › groupMode`, 'A device in a redundancy group should say how the group works');
  }

  // Power must not go in circles (A feeds B feeds A)
  for (const d of topo.devices) {
    const seen = new Set<string>();
    const stack = [...(d.power ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === d.id) {
        err(`device "${d.id}" › power`, 'Power sources form a cycle');
        break;
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(deviceById.get(cur)?.power ?? []));
    }
  }

  // --- Links ------------------------------------------------------------------------------
  const linked = new Set<string>();
  for (const l of topo.links) {
    const at = `link "${l.id}"`;
    for (const end of [l.a, l.b]) {
      if (!deviceIds.has(end.device)) err(at, `Device "${end.device}" does not exist`);
      linked.add(end.device);
    }
    if (l.a.device === l.b.device) err(at, 'A device cannot be linked to itself');
    for (const v of l.vlans ?? []) if (!vlanIds.has(v)) err(`${at} › vlans`, `VLAN ${v} is not defined`);
    if (l.kind === 'vpn') {
      const via = l.via ? linkById.get(l.via) : undefined;
      if (!l.via) err(`${at} › via`, 'A VPN tunnel must name the WAN link it rides on');
      else if (!via) err(`${at} › via`, `Link "${l.via}" does not exist`);
      else if (via.kind !== 'wan') err(`${at} › via`, `Link "${l.via}" is not a WAN link`);
      else if (![via.a.device, via.b.device].some((d) => d === l.a.device || d === l.b.device))
        err(`${at} › via`, `WAN link "${l.via}" does not start at either end of the tunnel`);
    } else if (l.via) warn(`${at} › via`, '"via" is only meaningful for VPN links');
  }
  for (const d of topo.devices) {
    if (!linked.has(d.id) && !topo.devices.some((o) => o.power?.includes(d.id))) warn(`device "${d.id}"`, 'Device has no link and powers nothing');
  }

  // --- Services ---------------------------------------------------------------------------
  for (const s of topo.services) {
    const at = `service "${s.id}"`;
    if (s.scope === 'global') {
      if (!s.providers?.length) err(at, 'A global service needs at least one provider');
      for (const p of s.providers ?? []) if (!deviceIds.has(p)) err(`${at} › providers`, `Device "${p}" does not exist`);
    } else {
      if (!s.providerRoles?.length) err(at, 'A per-site service needs "providerRoles"');
      for (const r of s.providerRoles ?? []) if (!roleIds.has(r)) err(`${at} › providerRoles`, `Role "${r}" is not defined`);
      for (const site of topo.sites.filter((x) => x.kind !== 'external')) {
        if (!topo.devices.some((d) => d.site === site.id && s.providerRoles?.includes(d.role))) err(at, `Site "${site.id}" has no device that provides it`);
      }
    }
    for (const u of s.upstream ?? []) if (!serviceIds.has(u)) err(`${at} › upstream`, `Service "${u}" is not defined`);
  }

  // --- Access policy ----------------------------------------------------------------------
  for (const r of topo.accessPolicy.rules) {
    const at = `rule "${r.id}"`;
    for (const v of [...r.from, ...r.to]) if (typeof v === 'number' && !vlanIds.has(v)) err(at, `VLAN ${v} is not defined`);
    if (r.serviceKeys?.length && r.action === 'deny') warn(at, '"serviceKeys" is only meaningful for permit rules');
    needKey(r.descriptionKey, at);
    for (const k of r.serviceKeys ?? []) needKey(k, at);
  }
  for (const r of topo.accessPolicy.enforcedOnRoles) if (!roleIds.has(r)) err('accessPolicy › enforcedOnRoles', `Role "${r}" is not defined`);

  // --- Cluster (cluster.json) ---------------------------------------------------------------
  let cluster: ClusterData | undefined;
  if (rawCluster !== undefined) {
    const parsed = clusterSchema.safeParse(rawCluster);
    if (!parsed.success) issues.push(...zodIssues('cluster.json', parsed.error.issues));
    else {
      cluster = parsed.data;
      const hostIds = new Set(cluster.hosts.map((h) => h.id));
      const vmIds = new Set(cluster.vms.map((v) => v.id));
      for (const h of cluster.hosts) if (deviceById.get(h.id)?.role !== 'esxi-host') err(`cluster.json › host "${h.id}"`, 'Is not an ESXi host in the topology');
      for (const d of topo.devices) {
        if (d.role === 'esxi-host' && !hostIds.has(d.id)) err(`cluster.json › hosts`, `Host "${d.id}" from the topology is missing`);
        if (d.runsOn && !vmIds.has(d.id)) err(`cluster.json › vms`, `VM "${d.id}" from the topology is missing`);
      }
      const used = new Map<string, number>();
      for (const v of cluster.vms) {
        const host = deviceById.get(v.id)?.runsOn;
        if (!host) err(`cluster.json › vm "${v.id}"`, 'Is not a VM in the topology (no "runsOn")');
        else used.set(host, (used.get(host) ?? 0) + v.ramGb);
      }
      for (const h of cluster.hosts) {
        if ((used.get(h.id) ?? 0) > h.ramGb) err(`cluster.json › host "${h.id}"`, `Initial VMs need ${used.get(h.id)} GB, the host has ${h.ramGb} GB`);
      }
      // N+1: after any single host failure, HA must be able to restart every VM. Checked by real
      // placement, not by adding up free memory: free space split over two hosts does not fit one large VM.
      const initial = new Map(topo.devices.filter((d) => d.runsOn).map((d) => [d.id, d.runsOn!]));
      for (const h of cluster.hosts) {
        const lost = [...placeVms(cluster, initial, (id) => id !== h.id)].filter(([, p]) => !p.host).map(([vm]) => vm);
        if (lost.length) warn('cluster.json', `If ${h.id} fails, HA cannot restart ${lost.join(', ')} (N+1 not met)`);
      }
      for (const r of cluster.rules) for (const v of r.vms) if (!vmIds.has(v)) err('cluster.json › rules', `VM "${v}" is not defined`);
      for (const c of cluster.storage.controllers) if (!deviceIds.has(c)) err('cluster.json › storage', `Controller "${c}" is not a device`);
      for (const row of cluster.spof) {
        for (const part of ['component', 'how', 'fails']) needKey(`ha.spof.${row.id}.${part}`, `cluster.json › spof "${row.id}"`);
        if (row.try?.kind === 'device' && !deviceIds.has(row.try.id)) err(`cluster.json › spof "${row.id}"`, `Device "${row.try.id}" does not exist`);
        if (row.try?.kind === 'link' && !topo.links.some((l) => l.id === row.try!.id)) err(`cluster.json › spof "${row.id}"`, `Link "${row.try.id}" does not exist`);
      }
      for (const s of cluster.before) if (!serviceIds.has(s)) err('cluster.json › before', `Service "${s}" is not defined`);
    }
  }

  const ok = !issues.some((i) => i.severity === 'error');
  return { ok, issues, keys, topology: topo, roles, cluster };
}
