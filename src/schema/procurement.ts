/**
 * Procurement simulation (Module D, hardware phase). Pure functions, no UI.
 *
 *   cartFromBom  the standard kit for a clinic, as a shopping cart (sku → quantity)
 *   preflight    order checks: ports, PoE, UPS, licences, Mac channel, spares, lead times,
 *                standard models, complete kit – each with an optional one-click fix
 *   schedule     when every item arrives at HQ and is ready on site, against the opening date
 *   inventory    one row per unit, mapped onto the devices of the new clinic
 *
 * Days are counted relative to go-live (negative = before). All numbers are illustrative.
 */
import type { TopologyIndex } from '../utils/topologyIndex';
import { computeBom, type Bom, type BomInput, type Catalog, type CatalogItem } from './playbook';

export type Cart = Record<string, number>;

export const sellable = (catalog: Catalog) => catalog.items.filter((i) => i.category && !i.vendor);

export function cartFromBom(bom: Bom): Cart {
  const cart: Cart = {};
  for (const l of bom.lines) if (l.item.category && !l.item.vendor) cart[l.item.sku] = l.qty;
  return cart;
}

const qty = (cart: Cart, sku: string) => cart[sku] ?? 0;
const item = (catalog: Catalog, sku: string) => catalog.items.find((i) => i.sku === sku)!;
const units = (catalog: Catalog, cart: Cart, pick: (i: CatalogItem) => boolean) => catalog.items.filter(pick).reduce((s, i) => s + qty(cart, i.sku), 0);

export type CheckId = 'coverage' | 'ports' | 'poe' | 'ups' | 'licences' | 'mdm' | 'spares' | 'leadtime' | 'standard';

export interface Check {
  id: CheckId;
  ok: boolean;
  /** Values for the text: numbers, or SKU lists under "items" */
  params: Record<string, number | string[]>;
  /** The cart after a one-click fix, if there is one */
  fix?: Cart;
}

export interface Arrival {
  sku: string;
  arrivalDay: number;
  readyDay: number;
  /** Days later than needed for the installation (0 = in time) */
  lateDays: number;
}

/** When each item arrives at HQ and is ready in the clinic. */
export function schedule(catalog: Catalog, cart: Cart, orderWeek: number): Arrival[] {
  const orderDay = orderWeek * 7;
  const needed = -catalog.timing.neededBeforeGoLiveDays;
  return sellable(catalog)
    .filter((i) => qty(cart, i.sku) > 0)
    .map((i) => {
      const arrivalDay = orderDay + (i.leadDays ?? 0);
      const readyDay = arrivalDay + catalog.timing.readyAfterArrivalDays;
      return { sku: i.sku, arrivalDay, readyDay, lateDays: Math.max(0, readyDay - needed) };
    })
    .sort((a, b) => b.readyDay - a.readyDay || a.sku.localeCompare(b.sku));
}

/**
 * The order checks. `input` is the size of the clinic: it decides what the kit needs, how many
 * ports the vendor's medical devices take, and which spares are expected.
 */
export function preflight(catalog: Catalog, cart: Cart, input: BomInput, orderWeek: number): Check[] {
  const bom = computeBom(catalog, input);
  const need = new Map(bom.lines.map((l) => [l.item.sku, l.qty]));
  const nonStandard = sellable(catalog).filter((i) => !i.standard && qty(cart, i.sku) > 0);
  const refill = (base: Cart) => {
    const next = { ...base };
    for (const [sku, n] of need) {
      const it = item(catalog, sku);
      if (!it.category || it.vendor) continue;
      const standIns = catalog.items.filter((x) => x.replaces === sku).reduce((s, x) => s + qty(next, x.sku), 0);
      if (qty(next, sku) + standIns < n) next[sku] = n - standIns;
    }
    return next;
  };
  const checks: Check[] = [];

  // Every item of the kit is in the cart (or something that stands in for it)
  const missing = [...need].filter(([sku, n]) => {
    const it = item(catalog, sku);
    if (!it.category || it.vendor) return false;
    const stand = catalog.items.filter((x) => x.replaces === sku).reduce((s, x) => s + qty(cart, x.sku), 0);
    return qty(cart, sku) + stand < n;
  });
  checks.push({ id: 'coverage', ok: missing.length === 0, params: { items: missing.map(([sku]) => sku) }, fix: missing.length ? refill(cart) : undefined });

  // Switch ports for every wired device, including the vendor's medical devices
  const vendorPorts = bom.lines.filter((l) => l.item.vendor && l.item.port).reduce((s, l) => s + l.qty, 0);
  const portsUsed = units(catalog, cart, (i) => !!i.port) + vendorPorts;
  const portsTotal = catalog.items.reduce((s, i) => s + (i.ports ?? 0) * qty(cart, i.sku), 0);
  const switchSku = catalog.items.find((i) => i.standard && i.rule.perPorts)!;
  checks.push({
    id: 'ports',
    ok: portsUsed <= portsTotal,
    params: { used: portsUsed, total: portsTotal },
    fix: portsUsed > portsTotal ? { ...cart, [switchSku.sku]: qty(cart, switchSku.sku) + Math.ceil((portsUsed - portsTotal) / (switchSku.ports ?? 1)) } : undefined,
  });

  // PoE budget for access points and phones
  const poeUsed = catalog.items.reduce((s, i) => s + (i.poeW ?? 0) * qty(cart, i.sku), 0);
  const poeBudget = catalog.items.reduce((s, i) => s + (i.poeBudgetW ?? 0) * qty(cart, i.sku), 0);
  checks.push({ id: 'poe', ok: poeUsed <= poeBudget, params: { used: poeUsed, budget: poeBudget } });

  // UPS carries the cabinet: firewall, switches and the PoE they hand out
  const load = catalog.items.reduce((s, i) => s + (i.loadW ?? 0) * qty(cart, i.sku), 0) + poeUsed;
  const capacity = catalog.items.reduce((s, i) => s + (i.capacityW ?? 0) * qty(cart, i.sku), 0);
  const upsSku = catalog.items.find((i) => i.standard && i.capacityW)!;
  checks.push({
    id: 'ups',
    ok: load <= capacity,
    params: { load, capacity },
    fix: load > capacity ? { ...cart, [upsSku.sku]: Math.ceil(load / upsSku.capacityW!) } : undefined,
  });

  // Licences: one per managed network device, one MDM seat per Mac
  // Spares on the shelf need no licence until they are installed
  const NET_ROLES = ['clinic-firewall', 'access-switch', 'access-point'];
  const shelf = catalog.spares.filter((sp) => NET_ROLES.includes(item(catalog, sp.sku).role ?? '')).reduce((s, sp) => s + Math.min(sp.count, Math.max(0, qty(cart, sp.sku) - (need.get(sp.sku) ?? 0))), 0);
  const netDevices = units(catalog, cart, (i) => !!i.role && NET_ROLES.includes(i.role) && i.standard) - shelf;
  const macs = units(catalog, cart, (i) => !!i.channel);
  const netLic = catalog.items.find((i) => i.licence === 'network')!;
  const mdmLic = catalog.items.find((i) => i.licence === 'mdm')!;
  const licOk = qty(cart, netLic.sku) >= netDevices && qty(cart, mdmLic.sku) >= macs;
  checks.push({
    id: 'licences',
    ok: licOk,
    params: { net: netDevices, mdm: macs },
    fix: licOk ? undefined : { ...cart, [netLic.sku]: Math.max(qty(cart, netLic.sku), netDevices), [mdmLic.sku]: Math.max(qty(cart, mdmLic.sku), macs) },
  });

  // Macs through the business channel enrol in the MDM by themselves
  const retail = units(catalog, cart, (i) => i.channel === 'retail');
  checks.push({ id: 'mdm', ok: retail === 0, params: { count: retail } });

  // Spares on top of the kit
  const noSpare = catalog.spares.filter((s) => qty(cart, s.sku) < (need.get(s.sku) ?? 0) + s.count);
  checks.push({
    id: 'spares',
    ok: noSpare.length === 0,
    params: { items: (noSpare.length ? noSpare : catalog.spares).map((s) => s.sku) },
    fix: noSpare.length ? Object.fromEntries([...Object.entries(cart), ...noSpare.map((s) => [s.sku, (need.get(s.sku) ?? 0) + s.count] as const)]) : undefined,
  });

  // Longest lead time against the installation date
  const late = schedule(catalog, cart, orderWeek).filter((a) => a.lateDays > 0);
  const longest = Math.max(0, ...sellable(catalog).filter((i) => qty(cart, i.sku) > 0).map((i) => i.leadDays ?? 0));
  checks.push({ id: 'leadtime', ok: late.length === 0, params: late.length ? { items: late.map((a) => a.sku), days: late[0].lateDays } : { days: longest } });

  // Only standard models
  checks.push({
    id: 'standard',
    ok: nonStandard.length === 0,
    params: { items: nonStandard.map((i) => i.sku) },
    fix: nonStandard.length ? refill(Object.fromEntries(Object.entries(cart).filter(([sku]) => !nonStandard.some((i) => i.sku === sku)))) : undefined,
  });

  return checks;
}

// --- Inventory -------------------------------------------------------------------------------

export interface InventoryRow {
  sku: string;
  /** Device of the new clinic this unit becomes (from the template), if any */
  device?: string;
  hostname?: string;
  model?: string;
  serial: string;
  asset: string;
  zone?: string;
  vlan?: number;
  ip?: string;
  dhcp?: boolean;
  warrantyMonths?: number;
  spare: boolean;
}

/** Deterministic fictional serial number: the same cart always gives the same serials. */
function serialOf(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return `SN${h.toString(36).toUpperCase().padStart(7, '0').slice(0, 8)}`;
}

export function inventory(catalog: Catalog, cart: Cart, index: TopologyIndex, siteId: string, input: BomInput): InventoryRow[] {
  const site = index.sites.get(siteId)!;
  const devices = index.devicesOfSite(siteId);
  const need = new Map(computeBom(catalog, input).lines.map((l) => [l.item.sku, l.qty]));
  const rows: InventoryRow[] = [];
  let seq = 0;
  for (const it of sellable(catalog)) {
    const n = qty(cart, it.sku);
    if (n === 0 || it.licence) continue;
    // Units become the template devices of the same role, in order; the rest are spares
    const role = it.role ?? catalog.items.find((x) => x.sku === it.replaces)?.role;
    const matching = role ? devices.filter((d) => d.role === role) : [];
    for (let i = 0; i < n; i++) {
      seq++;
      const d = matching[i];
      rows.push({
        sku: it.sku,
        device: d?.id,
        hostname: d?.name,
        model: it.model,
        serial: serialOf(`${siteId}-${it.sku}-${i}`),
        asset: `PW-${site.code}-${String(seq).padStart(4, '0')}`,
        zone: d?.zone,
        vlan: d?.vlan,
        ip: d?.ip,
        dhcp: d?.dhcp,
        warrantyMonths: it.warrantyMonths,
        spare: !d && i >= (need.get(it.sku) ?? n),
      });
    }
  }
  return rows;
}
