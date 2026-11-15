/**
 * Module D – clinic opening: schemas of playbook.json and catalog.json, validation, and the
 * artefacts computed from data:
 *   computeBom   bill of materials from the standard kit and the size of the clinic
 *   ipPlan       VLANs and fixed addresses of the new site (10.<site>.<vlan>.0/24)
 *   portPlan     which device sits on which switch port, from the clinic template
 *   isLive       the opening is far enough to treat the site as live
 *
 * Texts by convention:
 *   opening.phase.<id>.title | goal | check.<item> | pitfall.<n>
 *   opening.people.<id>
 *   opening.artefact.<id>.title | item.<n>   (list artefacts)
 */
import { z } from 'zod';
import type { Issue } from './validateI18n';
import type { Topology } from './topology.schema';
import type { TopologyIndex } from '../utils/topologyIndex';
import { gatewayOf, ipToNumber, subnetOf, subnetPrefix } from '../utils/ip';

const id = z.string().regex(/^[a-z0-9-]+$/);

const artefactSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list'), id, items: z.number().int().min(1).max(8) }).strict(),
  z.object({ type: z.literal('procurement') }).strict(),
  z.object({ type: z.literal('ip-plan') }).strict(),
  z.object({ type: z.literal('port-plan') }).strict(),
]);

export const phaseSchema = z
  .object({
    id,
    /** Weeks relative to go-live (negative = before) */
    startWeek: z.number().int(),
    weeks: z.number().int().min(1),
    people: z.array(id).min(1),
    checklist: z.array(id).min(1),
    pitfalls: z.number().int().min(1).max(3),
    artefact: artefactSchema,
  })
  .strict();

export const playbookSchema = z
  .object({
    illustrative: z.boolean(),
    site: id,
    /** The site counts as live once every phase up to and including this one is complete */
    liveAfter: id,
    dhcpPool: z.object({ from: z.number().int().min(2).max(253), to: z.number().int().min(2).max(254) }).strict(),
    phases: z.array(phaseSchema).min(1),
  })
  .strict();

const ruleSchema = z
  .object({
    fixed: z.number().min(0).optional(),
    perRoom: z.number().min(0).optional(),
    perDesk: z.number().min(0).optional(),
    perFeature: z.record(z.number().min(0)).optional(),
    /** One per this many wired ports: 24-port switch minus uplink and one spare */
    perPorts: z.number().int().positive().optional(),
    /** At least one per this many square metres of floor (access points) */
    minPerAreaM2: z.number().positive().optional(),
    /** One per unit of these SKUs (licences) */
    per: z.array(id).optional(),
  })
  .strict();

export const catalogItemSchema = z
  .object({
    sku: id,
    /** Shop shelf; items without one (vendor-supplied ports) are not sold */
    category: id.optional(),
    model: z.string().optional(),
    /** Device role in the topology; gives the name. Without a role, labelKey names it. */
    role: id.optional(),
    labelKey: z.string().optional(),
    /** Needs one switch port */
    port: z.boolean().optional(),
    poeW: z.number().positive().optional(),
    poeBudgetW: z.number().positive().optional(),
    /** Supplied by the medical device vendor; IT only provides port and VLAN */
    vendor: z.boolean().optional(),
    /** Usable switch ports (switches only) */
    ports: z.number().int().positive().optional(),
    /** Power drawn in the cabinet, and what a UPS can carry */
    loadW: z.number().positive().optional(),
    capacityW: z.number().positive().optional(),
    /** Macs: bought through the business channel (enrol automatically) or in a retail shop */
    channel: z.enum(['business', 'retail']).optional(),
    /** A licence: network cloud management or MDM seat */
    licence: z.enum(['network', 'mdm']).optional(),
    /** false = not in the standard kit; "replaces" names the standard item it stands in for */
    standard: z.boolean().default(true),
    replaces: id.optional(),
    leadDays: z.number().int().min(0).optional(),
    hqStock: z.number().int().min(0).optional(),
    warrantyMonths: z.number().int().positive().optional(),
    rule: ruleSchema,
  })
  .strict();

export const catalogSchema = z
  .object({
    illustrative: z.boolean(),
    categories: z.array(id).min(1),
    items: z.array(catalogItemSchema).min(1),
    /** Spares every opening should order on top of the kit */
    spares: z.array(z.object({ sku: id, count: z.number().int().positive() }).strict()).default([]),
    /** Delivery steps; "day" = days after the last item reached HQ (illustrative) */
    delivery: z.array(z.object({ id, day: z.number().int().min(0) }).strict()).min(1),
    timing: z.object({ readyAfterArrivalDays: z.number().int().min(0), neededBeforeGoLiveDays: z.number().int().min(0) }).strict(),
    defaults: z.object({ rooms: z.number().int().min(1), desks: z.number().int().min(1), areaM2: z.number().positive(), xray: z.boolean(), lab: z.boolean(), orderWeek: z.number().int() }).strict(),
  })
  .strict();

export type Playbook = z.infer<typeof playbookSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogItem = z.infer<typeof catalogItemSchema>;

export const checkKey = (phase: string, item: string) => `${phase}:${item}`;

// --- Validation ------------------------------------------------------------------------------

export function validatePlaybook(rawPlaybook: unknown, rawCatalog: unknown, index: TopologyIndex): { issues: Issue[]; playbook?: Playbook; catalog?: Catalog; keys: Array<{ key: string; where: string }> } {
  const issues: Issue[] = [];
  const keys: Array<{ key: string; where: string }> = [];
  const err = (path: string, message: string) => issues.push({ severity: 'error', path, message });
  const need = (key: string, where: string) => keys.push({ key, where });

  const pb = playbookSchema.safeParse(rawPlaybook);
  const cat = catalogSchema.safeParse(rawCatalog);
  if (!pb.success) for (const i of pb.error.issues) err(`playbook.json › ${i.path.join(' › ') || '(root)'}`, i.message);
  if (!cat.success) for (const i of cat.error.issues) err(`catalog.json › ${i.path.join(' › ') || '(root)'}`, i.message);
  if (!pb.success || !cat.success) return { issues, keys };
  const playbook = pb.data;
  const catalog = cat.data;

  if (!index.sites.has(playbook.site)) err('playbook.json › site', `Site "${playbook.site}" is not defined`);
  else if (index.sites.get(playbook.site)!.status !== 'planned') err('playbook.json › site', `Site "${playbook.site}" should be "planned" in topology.json`);
  if (!playbook.phases.some((p) => p.id === playbook.liveAfter)) err('playbook.json › liveAfter', `Phase "${playbook.liveAfter}" does not exist`);
  if (playbook.dhcpPool.from >= playbook.dhcpPool.to) err('playbook.json › dhcpPool', '"from" must be below "to"');

  const seen = new Set<string>();
  const people = new Set<string>();
  for (const p of playbook.phases) {
    const at = `playbook.json › phase "${p.id}"`;
    if (seen.has(p.id)) err(at, 'Id is used more than once');
    seen.add(p.id);
    if (new Set(p.checklist).size !== p.checklist.length) err(at, 'A checklist item is listed twice');
    need(`opening.phase.${p.id}.title`, at);
    need(`opening.phase.${p.id}.goal`, at);
    for (const c of p.checklist) need(`opening.phase.${p.id}.check.${c}`, at);
    for (let i = 1; i <= p.pitfalls; i++) need(`opening.phase.${p.id}.pitfall.${i}`, at);
    p.people.forEach((x) => people.add(x));
    if (p.artefact.type === 'list') {
      need(`opening.artefact.${p.artefact.id}.title`, at);
      for (let i = 1; i <= p.artefact.items; i++) need(`opening.artefact.${p.artefact.id}.item.${i}`, at);
    }
  }
  for (const x of people) need(`opening.people.${x}`, 'playbook.json › people');

  const skus = new Set<string>();
  for (const item of catalog.items) {
    const at = `catalog.json › item "${item.sku}"`;
    if (skus.has(item.sku)) err(at, 'SKU is used more than once');
    skus.add(item.sku);
    if (item.role && !index.roles.has(item.role)) err(at, `Role "${item.role}" is not defined`);
    if (!item.role && !item.labelKey) err(at, 'An item needs a "role" or a "labelKey"');
    if (item.labelKey) need(item.labelKey, at);
    for (const f of Object.keys(item.rule.perFeature ?? {})) need(`opening.bom.${f}`, at);
    for (const s of item.rule.per ?? []) if (!catalog.items.some((i) => i.sku === s)) err(at, `SKU "${s}" in "per" does not exist`);
    if (item.category && !catalog.categories.includes(item.category)) err(at, `Category "${item.category}" is not listed`);
    if (item.category && item.leadDays === undefined) err(at, 'Items sold in the shop need "leadDays"');
    if (!item.standard) {
      need(`shop.warn.${item.sku}`, at);
      if (!item.replaces || !catalog.items.some((i) => i.sku === item.replaces && i.standard)) err(at, 'A non-standard item must name the standard item it "replaces"');
    }
  }
  for (const c of catalog.categories) need(`shop.category.${c}`, 'catalog.json › categories');
  for (const d of catalog.delivery) need(`shop.step.${d.id}`, 'catalog.json › delivery');
  for (const s of catalog.spares) if (!catalog.items.some((i) => i.sku === s.sku)) err('catalog.json › spares', `SKU "${s.sku}" does not exist`);
  if (catalog.items.filter((i) => i.rule.perPorts).length !== 1) err('catalog.json', 'Exactly one item (the switch) must have a "perPorts" rule');
  return { issues, playbook, catalog, keys };
}

// --- Progress --------------------------------------------------------------------------------

export function phaseProgress(phase: Phase, done: ReadonlySet<string>): { done: number; total: number; complete: boolean } {
  const n = phase.checklist.filter((c) => done.has(checkKey(phase.id, c))).length;
  return { done: n, total: phase.checklist.length, complete: n === phase.checklist.length };
}

/** Live once every phase up to and including `liveAfter` is complete. */
export function isLive(playbook: Playbook, done: ReadonlySet<string>): boolean {
  const last = playbook.phases.findIndex((p) => p.id === playbook.liveAfter);
  return playbook.phases.slice(0, last + 1).every((p) => phaseProgress(p, done).complete);
}

// --- Bill of materials -----------------------------------------------------------------------

export interface BomInput {
  rooms: number;
  desks: number;
  features: Record<string, boolean>;
  /** Floor area; access points get at least one per "minPerAreaM2" */
  areaM2?: number;
}

export interface BomLine {
  item: CatalogItem;
  qty: number;
}

export interface Bom {
  lines: BomLine[];
  ports: number;
  poeW: number;
  poeBudgetW: number;
}

/** The standard kit for a clinic of this size. Non-standard items are never part of it. */
export function computeBom(catalog: Catalog, input: BomInput): Bom {
  const qty = new Map<string, number>();
  const base = (item: CatalogItem) => {
    const r = item.rule;
    let q = (r.fixed ?? 0) + (r.perRoom ?? 0) * input.rooms + (r.perDesk ?? 0) * input.desks;
    for (const [f, n] of Object.entries(r.perFeature ?? {})) if (input.features[f]) q += n;
    q = Math.ceil(q - 1e-9);
    if (r.minPerAreaM2 && input.areaM2) q = Math.max(q, Math.ceil(input.areaM2 / r.minPerAreaM2));
    return q;
  };
  const standard = catalog.items.filter((i) => i.standard);
  // 1. Plain rules  2. Switches from the wired ports  3. Licences per unit of other items
  for (const item of standard) if (!item.rule.perPorts && !item.rule.per) qty.set(item.sku, base(item));
  const ports = standard.filter((i) => i.port).reduce((s, i) => s + (qty.get(i.sku) ?? 0), 0);
  const switchItem = standard.find((i) => i.rule.perPorts)!;
  qty.set(switchItem.sku, Math.max(1, Math.ceil(ports / switchItem.rule.perPorts!)));
  for (const item of standard) if (item.rule.per) qty.set(item.sku, item.rule.per.reduce((s, sku) => s + (qty.get(sku) ?? 0), 0));

  const lines = standard.map((item) => ({ item, qty: qty.get(item.sku) ?? 0 })).filter((l) => l.qty > 0);
  const poeW = lines.reduce((s, l) => s + (l.item.poeW ?? 0) * l.qty, 0);
  return { lines, ports, poeW, poeBudgetW: (qty.get(switchItem.sku) ?? 0) * (switchItem.poeBudgetW ?? 0) };
}

// --- IP plan and port plan -------------------------------------------------------------------

export interface IpPlanRow {
  vlan: number;
  name: string;
  subnet: string;
  gateway: string;
  dhcp: string | null;
}

export function ipPlan(topo: Topology, siteId: string, pool: Playbook['dhcpPool']): { vlans: IpPlanRow[]; statics: Array<{ device: string; ip: string; vlan: number }> } {
  const site = topo.sites.find((s) => s.id === siteId);
  const n = site?.number ?? 0;
  const vlans = topo.vlans
    .filter((v) => v.scope === 'all')
    .map((v) => ({
      vlan: v.id,
      name: v.name,
      subnet: subnetOf(n, v.id),
      gateway: gatewayOf(n, v.id),
      dhcp: v.dhcp ? `${subnetPrefix(n, v.id)}${pool.from} – ${subnetPrefix(n, v.id)}${pool.to}` : null,
    }));
  const statics = topo.devices
    .filter((d) => d.site === siteId && d.ip && d.vlan !== undefined)
    .map((d) => ({ device: d.id, ip: d.ip!, vlan: d.vlan! }))
    .sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip));
  return { vlans, statics };
}

export interface PortPlanRow {
  switch: string;
  port: string;
  device: string;
  /** Access VLAN, or the VLANs of a trunk */
  vlans: number[];
  trunk: boolean;
  poe: boolean;
}

export function portPlan(index: TopologyIndex, siteId: string): PortPlanRow[] {
  const switches = new Set(index.devicesOfSite(siteId).filter((d) => d.role === 'access-switch').map((d) => d.id));
  const rows: PortPlanRow[] = [];
  for (const l of index.topology.links) {
    for (const [self, other] of [
      [l.a, l.b],
      [l.b, l.a],
    ] as const) {
      if (!switches.has(self.device) || !self.port) continue;
      const device = index.devices.get(other.device);
      if (!device) continue;
      const trunk = !!l.vlans?.length;
      rows.push({
        switch: self.device,
        port: self.port,
        device: device.id,
        vlans: trunk ? l.vlans! : device.vlan !== undefined ? [device.vlan] : [],
        trunk,
        poe: !!device.power?.includes(self.device),
      });
    }
  }
  return rows.sort((a, b) => a.switch.localeCompare(b.switch) || Number(a.port) - Number(b.port));
}
