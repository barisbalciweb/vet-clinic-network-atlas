/**
 * Turns the raw topology (sites + templates) into concrete zones, devices and links.
 *
 * Every site with a `template` gets a copy of the template items, with
 *   {site} → site id ("hh"), {code} → hostname prefix ("HH"), {n} → site number (2)
 * replaced in all texts. Items with `when` are kept only if the site matches.
 * VMs with `runsOn` get a virtual link to their host.
 *
 * Adding a clinic therefore means: one new entry in `sites`. Nothing else.
 */
import type { Device, Link, RawTopology, Site, Topology, Zone } from './topology.schema';

type When = { variant?: string[]; feature?: string } | undefined;

function matches(when: When, site: Site): boolean {
  if (!when) return true;
  if (when.variant && !(site.variant !== undefined && when.variant.includes(site.variant))) return false;
  if (when.feature && !site.features.includes(when.feature)) return false;
  return true;
}

/** Replaces the placeholders in every string of a JSON-like value. */
function fill<T>(value: T, site: Site): T {
  if (typeof value === 'string') {
    return value.replaceAll('{site}', site.id).replaceAll('{code}', site.code).replaceAll('{n}', String(site.number ?? '')) as T;
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, site)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, site)])) as T;
  }
  return value;
}

function strip<T extends { when?: unknown }>(item: T): Omit<T, 'when'> {
  const { when: _when, ...rest } = item;
  void _when;
  return rest;
}

export function expandTopology(raw: RawTopology): Topology {
  const zones: Zone[] = [];
  const devices: Device[] = [];
  const links: Link[] = [];

  // Explicit items (HQ, internet, cloud). A missing site is reported by the validator.
  for (const z of raw.zones) zones.push({ ...strip(z), site: z.site ?? '' });
  const zoneSite = new Map(zones.map((z) => [z.id, z.site]));
  for (const d of raw.devices) devices.push({ ...strip(d), site: d.site ?? zoneSite.get(d.zone) ?? '' });
  for (const l of raw.links) links.push(strip(l));

  // Template items, once per site
  for (const site of raw.sites) {
    const tpl = site.template ? raw.templates[site.template] : undefined;
    if (!tpl) continue;
    for (const z of tpl.zones) if (matches(z.when, site)) zones.push({ ...fill(strip(z), site), site: site.id });
    for (const d of tpl.devices) if (matches(d.when, site)) devices.push({ ...fill(strip(d), site), site: site.id });
    for (const l of tpl.links) if (matches(l.when, site)) links.push(fill(strip(l), site));
  }

  // VM → host
  for (const d of devices) {
    if (d.runsOn) links.push({ id: `virt-${d.id}`, a: { device: d.id }, b: { device: d.runsOn }, kind: 'virtual', medium: 'virtual' });
  }

  return { meta: raw.meta, vlans: raw.vlans, sites: raw.sites, zones, devices, links, services: raw.services, accessPolicy: raw.accessPolicy };
}
