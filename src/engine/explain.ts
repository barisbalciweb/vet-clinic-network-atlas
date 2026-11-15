/**
 * Turns a simulation result into what a person reads: the chain reaction, who is affected,
 * the order in which to test, and fix and prevention.
 *
 * Still no sentences here. Everything is returned as translation keys plus ids; the UI resolves
 * ids to names in the current language. Which keys and which test steps belong to which fault
 * comes from src/data/faults.json (actions, testSteps, guides, scenarios).
 *
 * Parameter names tell the UI what an id is:
 *   device, source, host        → device id        devices → device ids
 *   site                        → site id          sites   → site ids
 *   service                     → service id       services → service ids      link → link id
 *   vlan, count                 → numbers
 */
import { z } from 'zod';
import type { Device, Link, Role } from '../schema/topology.schema';
import type { Issue } from '../schema/validateI18n';
import type { TopologyIndex } from '../utils/topologyIndex';
import { gatewayOf } from '../utils/ip';
import type { ChainEvent, Fault, SimulationResult } from './types';

export const LAYERS = ['power', 'link', 'ip', 'dns', 'gateway', 'wan', 'vpn', 'service'] as const;
export type Layer = (typeof LAYERS)[number];

const id = z.string().regex(/^[A-Za-z0-9._-]+$/);

const actionSchema = z
  .object({
    id,
    /** What the action is applied to on the map */
    on: z.enum(['device', 'link']),
    type: z.enum(['power-off', 'link-cut', 'degrade', 'service-failure']),
    variant: z.enum(['stopped', 'dns-stopped', 'dhcp-exhausted', 'cert-expired', 'tunnel-down']).optional(),
    /** Offered only for these device roles / link kinds; omitted = for all */
    roles: z.array(id).optional(),
    kinds: z.array(z.string()).optional(),
    /**
     * How the fault target is built from the clicked device:
     *   (omitted)         the device or link itself
     *   site-service      the service `service` in the device's site (optionally one VLAN)
     *   provider          the device stops providing `service`
     *   provided-service  the (first) global service the device provides, for everyone
     */
    target: z.enum(['site-service', 'provider', 'provided-service']).optional(),
    service: id.optional(),
    vlan: z.number().int().optional(),
  })
  .strict();

const guideSchema = z
  .object({
    id,
    /** First guide whose conditions all hold wins, so specific guides come before general ones */
    match: z.object({ action: id, roles: z.array(id).optional(), layers: z.array(z.string()).optional(), kinds: z.array(z.string()).optional() }).strict(),
    tests: z.array(id).min(1),
  })
  .strict();

export const faultDataSchema = z
  .object({
    actions: z.array(actionSchema),
    testSteps: z.array(z.object({ id, layer: z.enum(LAYERS), command: z.string().optional() }).strict()),
    guides: z.array(guideSchema),
    scenarios: z.array(z.object({ id, site: id, faults: z.array(z.object({ action: id, target: id }).strict()).min(1) }).strict()),
  })
  .strict();

export type FaultData = z.infer<typeof faultDataSchema>;
export type FaultAction = z.infer<typeof actionSchema>;
export type Guide = z.infer<typeof guideSchema>;

/** A fault as the user created it: which action on which device or link. */
export interface ActiveFault {
  action: string;
  /** Device or link id the action was applied to */
  target: string;
  fault: Fault;
}

export const faultKey = (f: Pick<ActiveFault, 'action' | 'target'>) => `${f.action}@${f.target}`;

type Subject = { device: Device; role: Role | undefined } | { link: Link };

function subjectOf(index: TopologyIndex, targetId: string): Subject | undefined {
  const device = index.devices.get(targetId);
  if (device) return { device, role: index.roles.get(device.role) };
  const link = index.links.get(targetId);
  return link ? { link } : undefined;
}

function applies(action: FaultAction, subject: Subject): boolean {
  if ('device' in subject) return action.on === 'device' && (!action.roles || action.roles.includes(subject.device.role));
  return action.on === 'link' && (!action.kinds || action.kinds.includes(subject.link.kind));
}

/** The actions offered for a device or link. */
export function actionsFor(data: FaultData, index: TopologyIndex, targetId: string): FaultAction[] {
  const subject = subjectOf(index, targetId);
  return subject ? data.actions.filter((a) => applies(a, subject)) : [];
}

export function buildFault(data: FaultData, index: TopologyIndex, actionId: string, targetId: string): ActiveFault | undefined {
  const action = data.actions.find((a) => a.id === actionId);
  const subject = subjectOf(index, targetId);
  if (!action || !subject || !applies(action, subject)) return undefined;
  const base = { type: action.type, variant: action.variant };
  let fault: Fault;
  if ('link' in subject) fault = { ...base, target: { kind: 'link', id: targetId } };
  else if (action.target === 'site-service' && action.service) fault = { ...base, target: { kind: 'service', id: action.service, site: subject.device.site, vlan: action.vlan } };
  else if (action.target === 'provider') fault = { ...base, target: { kind: 'device', id: targetId }, service: action.service };
  else if (action.target === 'provided-service') {
    const service = index.providedBy(targetId).find((s) => s.scope === 'global');
    if (!service) return undefined;
    fault = { ...base, target: { kind: 'service', id: service.id } };
  } else fault = { ...base, target: { kind: 'device', id: targetId } };
  return { action: actionId, target: targetId, fault };
}

export function guideFor(data: FaultData, index: TopologyIndex, active: Pick<ActiveFault, 'action' | 'target'>): Guide | undefined {
  const subject = subjectOf(index, active.target);
  if (!subject) return undefined;
  return data.guides.find((g) => {
    if (g.match.action !== active.action) return false;
    if ('device' in subject) {
      if (g.match.kinds) return false;
      if (g.match.roles && !g.match.roles.includes(subject.device.role)) return false;
      if (g.match.layers && !(subject.role && g.match.layers.includes(subject.role.layer))) return false;
      return true;
    }
    if (g.match.roles || g.match.layers) return false;
    return !g.match.kinds || g.match.kinds.includes(subject.link.kind);
  });
}

// --- Explanation -----------------------------------------------------------------------------

export type ParamValue = string | number | string[];
export interface TextItem {
  key: string;
  params: Record<string, ParamValue>;
}

export type Outcome = 'healthy' | 'absorbed' | 'degraded' | 'outage';

export interface AffectedGroup {
  site: string;
  audience: string;
  items: Array<{ capability: string; state: 'down' | 'degraded'; devices: string[] }>;
}

export interface TestStep {
  id: string;
  layer: Layer;
  key: string;
  command?: string;
}

export interface Remedy {
  fault: ActiveFault;
  guide: string;
  workaroundKey: string;
  fixKey: string;
  preventionKey: string;
}

export interface Explanation {
  outcome: Outcome;
  chain: TextItem[];
  affected: AffectedGroup[];
  /** Per affected site: what people can still do */
  stillWorks: Array<{ site: string; capabilities: string[] }>;
  tests: TestStep[];
  remedies: Remedy[];
  warnings: TextItem[];
}

/** Keys of the chain and warning texts that the code refers to (checked by the validator). */
export const EVENT_KEYS = [
  'powerLost',
  'powerLostOne',
  'onBattery',
  'vmRestarted',
  'vmDownCapacity',
  'vmDownStorage',
  'vmDownHost',
  'wanFailover',
  'siteOffline',
  'vpnFailover',
  'vpnDown',
  'roaming',
  'serviceDown',
  'serviceDegraded',
] as const;
export const WARNING_KEYS = ['redundancyLost', 'capacityReserveUsed', 'onBattery', 'serviceRedundancyLost'] as const;

const SITE_EVENTS: Partial<Record<ChainEvent['kind'], (typeof EVENT_KEYS)[number]>> = {
  'wan-failover': 'wanFailover',
  'site-offline': 'siteOffline',
  'vpn-failover': 'vpnFailover',
  'vpn-down': 'vpnDown',
};
const VM_DOWN: Record<string, (typeof EVENT_KEYS)[number]> = { 'no-capacity': 'vmDownCapacity', 'no-storage': 'vmDownStorage' };

function faultParams(index: TopologyIndex, active: ActiveFault): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  const device = index.devices.get(active.target);
  if (device) {
    params.device = device.id;
    params.site = device.site;
  } else params.link = active.target;
  const t = active.fault.target;
  if (t.kind === 'service') {
    params.service = t.id;
    if (t.vlan !== undefined) params.vlan = t.vlan;
  } else if (active.fault.service) params.service = active.fault.service;
  return params;
}

/** The chain of the engine, shortened: events of the same kind are merged into one line. */
function compactChain(index: TopologyIndex, active: ActiveFault[], result: SimulationResult): TextItem[] {
  const items: TextItem[] = [];
  const groups = new Map<string, TextItem>();
  const push = (groupKey: string, key: string, params: Record<string, ParamValue>, listParam: string, value: string) => {
    let item = groups.get(groupKey);
    if (!item) {
      item = { key: `faults.event.${key}`, params: { ...params, [listParam]: [] } };
      groups.set(groupKey, item);
      items.push(item);
    }
    const list = item.params[listParam] as string[];
    if (!list.includes(value)) list.push(value);
    item.params.count = list.length;
  };

  for (const e of result.chain) {
    if (e.kind === 'fault') {
      const a = active[e.fault];
      if (a) items.push({ key: `faults.action.${a.action}.done`, params: faultParams(index, a) });
    } else if (e.kind === 'power-lost') push(`power|${e.params.source}`, 'powerLost', { source: e.params.source }, 'devices', e.subject);
    else if (e.kind === 'on-battery') items.push({ key: 'faults.event.onBattery', params: { device: e.subject } });
    else if (e.kind === 'vm-restarted') push('vm-restarted', 'vmRestarted', {}, 'devices', e.subject);
    else if (e.kind === 'vm-down') push(`vm-down|${e.params.reason}`, VM_DOWN[e.params.reason] ?? 'vmDownHost', {}, 'devices', e.subject);
    else if (e.kind === 'roaming') push(`roaming|${e.site}`, 'roaming', { site: e.site ?? '' }, 'devices', e.subject);
    else if (e.kind === 'service-down') push(`down|${e.site}`, 'serviceDown', { site: e.site ?? '' }, 'services', e.subject);
    else if (e.kind === 'service-degraded') push(`degraded|${e.site}`, 'serviceDegraded', { site: e.site ?? '' }, 'services', e.subject);
    else {
      const key = SITE_EVENTS[e.kind];
      if (key) push(e.kind, key, {}, 'sites', e.subject);
    }
  }
  // A single device reads better as its own sentence
  for (const item of items) {
    if (item.key === 'faults.event.powerLost' && item.params.count === 1) {
      item.key = 'faults.event.powerLostOne';
      item.params.device = (item.params.devices as string[])[0];
    }
  }
  return items;
}

function testContext(index: TopologyIndex, active: ActiveFault): Record<string, string> {
  const link = index.links.get(active.target);
  // For a link: the end inside one of our sites tells us where to test from
  const device = index.devices.get(active.target) ?? (link ? [link.a.device, link.b.device].map((d) => index.devices.get(d)).find((d) => d && index.sites.get(d.site)?.number !== undefined) : undefined);
  const number = device ? index.sites.get(device.site)?.number : undefined;
  const ctx: Record<string, string> = {};
  if (device?.ip) ctx.ip = device.ip;
  if (number !== undefined) ctx.gateway = gatewayOf(number, device?.vlan ?? 20);
  return ctx;
}

export function explain(data: FaultData, index: TopologyIndex, active: ActiveFault[], result: SimulationResult): Explanation {
  // Who is affected, grouped by site and audience
  const groups = new Map<string, AffectedGroup>();
  for (const a of result.affected) {
    const key = `${a.site}|${a.audience}`;
    if (!groups.has(key)) groups.set(key, { site: a.site, audience: a.audience, items: [] });
    const items = groups.get(key)!.items;
    const same = items.find((i) => i.capability === a.capability && i.state === a.state);
    if (same) same.devices.push(...a.devices);
    else items.push({ capability: a.capability, state: a.state, devices: [...a.devices] });
  }
  const affected = [...groups.values()];

  // What still works in the affected sites: capabilities that are up on every device that has them
  const stillWorks: Explanation['stillWorks'] = [];
  for (const site of new Set(affected.filter((g) => g.audience !== 'it').map((g) => g.site))) {
    const bad = new Set<string>();
    const good = new Set<string>();
    for (const c of result.capabilities) {
      if (c.site !== site || c.audience === 'it') continue;
      (c.state === 'up' ? good : bad).add(c.capability);
    }
    const capabilities = [...good].filter((c) => !bad.has(c));
    if (capabilities.length) stillWorks.push({ site, capabilities });
  }

  // Test order and remedies, from the guide of each fault
  const steps = new Map<string, TestStep>();
  const remedies: Remedy[] = [];
  for (const a of active) {
    const guide = guideFor(data, index, a);
    if (!guide) continue;
    remedies.push({
      fault: a,
      guide: guide.id,
      workaroundKey: `faults.guide.${guide.id}.workaround`,
      fixKey: `faults.guide.${guide.id}.fix`,
      preventionKey: `faults.guide.${guide.id}.prevention`,
    });
    const ctx = testContext(index, a);
    for (const stepId of guide.tests) {
      const step = data.testSteps.find((s) => s.id === stepId);
      if (!step || steps.has(step.id)) continue;
      // A command is only shown if everything it needs is known
      const command = step.command?.replace(/\{(\w+)\}/g, (whole, name: string) => ctx[name] ?? whole);
      steps.set(step.id, { id: step.id, layer: step.layer, key: `faults.test.${step.id}`, command: command && !command.includes('{') ? command : undefined });
    }
  }
  const tests = [...steps.values()].sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer));

  const warnings = result.warnings.map((w): TextItem => {
    if (w.kind === 'on-battery') return { key: 'faults.warning.onBattery', params: { device: w.subject } };
    if (w.kind === 'service-redundancy-lost') return { key: 'faults.warning.serviceRedundancyLost', params: { service: w.subject, devices: w.missing } };
    if (w.kind === 'capacity-reserve-used') return { key: 'faults.warning.capacityReserveUsed', params: { devices: w.missing } };
    return { key: 'faults.warning.redundancyLost', params: { devices: w.missing } };
  });

  const outcome: Outcome =
    active.length === 0 ? 'healthy' : result.affected.some((a) => a.state === 'down') ? 'outage' : result.affected.length > 0 ? 'degraded' : 'absorbed';

  return { outcome, chain: compactChain(index, active, result), affected, stillWorks, tests, remedies, warnings };
}

// --- Validation ------------------------------------------------------------------------------

export interface FaultValidation {
  issues: Issue[];
  data?: FaultData;
  keys: Array<{ key: string; where: string }>;
}

/** Checks faults.json against the topology and lists every translation key it needs. */
export function validateFaultData(raw: unknown, index: TopologyIndex, roles: Role[]): FaultValidation {
  const issues: Issue[] = [];
  const keys: FaultValidation['keys'] = [];
  const err = (path: string, message: string) => issues.push({ severity: 'error', path: `faults.json › ${path}`, message });
  const parsed = faultDataSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) err(i.path.join(' › ') || '(root)', i.message);
    return { issues, keys };
  }
  const data = parsed.data;
  const need = (key: string, where: string) => keys.push({ key, where: `faults.json › ${where}` });
  const unique = (list: Array<{ id: string }>, what: string) => {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.id)) err(`${what} "${x.id}"`, 'Id is used more than once');
      seen.add(x.id);
    }
    return seen;
  };
  const actionIds = unique(data.actions, 'action');
  const stepIds = unique(data.testSteps, 'testStep');
  unique(data.guides, 'guide');
  unique(data.scenarios, 'scenario');
  const roleIds = new Set(roles.map((r) => r.id));

  for (const a of data.actions) {
    for (const r of a.roles ?? []) if (!roleIds.has(r)) err(`action "${a.id}"`, `Role "${r}" is not defined`);
    if ((a.target === 'site-service' || a.target === 'provider') && !a.service) err(`action "${a.id}"`, `Target "${a.target}" needs a "service"`);
    if (a.service && a.service !== 'vpn' && !index.services.has(a.service)) err(`action "${a.id}"`, `Service "${a.service}" is not defined`);
    need(`faults.action.${a.id}.label`, `action "${a.id}"`);
    need(`faults.action.${a.id}.done`, `action "${a.id}"`);
  }
  for (const s of data.testSteps) need(`faults.test.${s.id}`, `testStep "${s.id}"`);
  for (const l of LAYERS) need(`faults.layer.${l}`, 'layers');
  for (const g of data.guides) {
    if (!actionIds.has(g.match.action)) err(`guide "${g.id}"`, `Action "${g.match.action}" is not defined`);
    for (const t of g.tests) if (!stepIds.has(t)) err(`guide "${g.id}"`, `Test step "${t}" is not defined`);
    for (const part of ['workaround', 'fix', 'prevention']) need(`faults.guide.${g.id}.${part}`, `guide "${g.id}"`);
  }
  for (const s of data.scenarios) {
    if (!index.sites.has(s.site)) err(`scenario "${s.id}"`, `Site "${s.site}" is not defined`);
    for (const f of s.faults) if (!buildFault(data, index, f.action, f.target)) err(`scenario "${s.id}"`, `Action "${f.action}" cannot be applied to "${f.target}"`);
    need(`faults.scenario.${s.id}`, `scenario "${s.id}"`);
  }

  // Every action on every device and link must lead to a guide, or the result panel would be empty
  const missing = new Set<string>();
  for (const target of [...index.devices.keys(), ...index.links.keys()]) {
    for (const a of actionsFor(data, index, target)) {
      if (!guideFor(data, index, { action: a.id, target })) {
        const d = index.devices.get(target);
        missing.add(`${a.id} on ${d ? `role "${d.role}"` : `link kind "${index.links.get(target)!.kind}"`}`);
      }
    }
  }
  for (const m of missing) err('guides', `No guide matches ${m}`);

  // Texts the code builds from ids
  for (const k of EVENT_KEYS) need(`faults.event.${k}`, 'events');
  for (const k of WARNING_KEYS) need(`faults.warning.${k}`, 'warnings');
  for (const o of ['healthy', 'absorbed', 'degraded', 'outage']) need(`faults.outcome.${o}`, 'outcomes');
  const capabilities = new Set(roles.flatMap((r) => r.capabilities.map((c) => c.id)));
  const audiences = new Set(roles.flatMap((r) => r.capabilities.map((c) => c.audience)));
  for (const c of capabilities) need(`faults.cap.${c}`, `capability "${c}" (roles.json)`);
  for (const a of audiences) need(`faults.audience.${a}`, `audience "${a}" (roles.json)`);

  return { issues, data, keys };
}
