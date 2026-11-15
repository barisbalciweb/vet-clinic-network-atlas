/**
 * Zod schemas for src/data/topology.json and src/data/roles.json.
 * Full documentation with examples: docs/SCHEMA.md
 *
 * This file only validates the *shape* of each field. Template expansion is in expandTopology.ts,
 * cross-references ("does the device in this link exist?") are checked in validateTopology.ts.
 */
import { z } from 'zod';

export const SITE_KINDS = ['hq', 'clinic', 'external'] as const;
export const ZONE_KINDS = ['outside', 'cabinet', 'server-room', 'cluster', 'virtual', 'reception', 'waiting', 'office', 'treatment', 'xray', 'lab', 'cloud'] as const;
export const LINK_KINDS = ['lan', 'wifi', 'wan', 'vpn', 'storage', 'virtual'] as const;
export const LINK_MEDIA = ['copper', 'fiber', 'cable', 'dsl', 'lte', 'wireless', 'ipsec', 'virtual'] as const;
export const ROLE_LAYERS = ['infrastructure', 'endpoint', 'server', 'external'] as const;
export const NAMED_TARGETS = ['internet', 'hq-servers'] as const;

/** Ids may contain {site} / {code} / {n} inside a template; the expanded result is checked strictly. */
const idSchema = z.string().trim().min(1).regex(/^[A-Za-z0-9._{}-]+$/, 'Only letters, digits, dot, dash and underscore are allowed');
const keySchema = z.string().regex(/^[A-Za-z0-9]+(\.[A-Za-z0-9_-]+)+$/, 'Must be a translation key like "topology.zone.cabinet"');
const vlanIdSchema = z.number().int().min(1).max(4094);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be #RRGGBB');

/** Keeps a template item only for certain sites. All given conditions must match. */
const whenSchema = z.object({ variant: z.array(z.string()).optional(), feature: z.string().optional() }).strict();

export const vlanSchema = z
  .object({
    id: vlanIdSchema,
    name: z.string().min(1),
    color: colorSchema,
    /** all = every site · hq = only at HQ */
    scope: z.enum(['all', 'hq']),
    /** Address pool served by the site firewall */
    dhcp: z.boolean(),
    internet: z.enum(['full', 'restricted', 'none']),
  })
  .strict();

export const siteSchema = z
  .object({
    id: idSchema,
    /** Second octet of 10.<number>.<vlan>.0/24. Not needed for the external pseudo-site. */
    number: z.number().int().min(0).max(254).optional(),
    /** Hostname prefix */
    code: z.string().min(1),
    kind: z.enum(SITE_KINDS),
    template: z.string().optional(),
    variant: z.string().optional(),
    features: z.array(z.string()).default([]),
    status: z.enum(['live', 'planned']).default('live'),
    /** Position on the Germany schematic, 0–100 (x) and 0–120 (y) */
    map: z.object({ x: z.number(), y: z.number() }),
  })
  .strict();

export const zoneSchema = z
  .object({
    id: idSchema,
    site: idSchema.optional(),
    kind: z.enum(ZONE_KINDS),
    labelKey: keySchema,
    /** Fills {n} in the label ("Treatment room {n}") */
    number: z.number().int().optional(),
    /** Layout hints: zones with the same row are drawn side by side; devices wrap after `cols` */
    row: z.number().int().min(0),
    cols: z.number().int().min(1).max(8).optional(),
    when: whenSchema.optional(),
  })
  .strict();

export const deviceSchema = z
  .object({
    id: idSchema,
    /** Hostname, never translated */
    name: z.string().min(1),
    role: idSchema,
    site: idSchema.optional(),
    zone: idSchema,
    model: z.string().optional(),
    vlan: vlanIdSchema.optional(),
    /** Static address. Mutually exclusive with dhcp. */
    ip: z.string().optional(),
    dhcp: z.boolean().optional(),
    /** Power sources (device ids); powered if any of them is. Omitted = always powered. */
    power: z.array(idSchema).optional(),
    /** Redundancy group: members back each other up */
    group: z.string().optional(),
    groupMode: z.enum(['active-passive', 'active-active']).optional(),
    /** VMs: the host they start on */
    runsOn: idSchema.optional(),
    noteKey: keySchema.optional(),
    when: whenSchema.optional(),
  })
  .strict();

const linkEndSchema = z.object({ device: idSchema, port: z.string().min(1).optional() }).strict();

export const linkSchema = z
  .object({
    id: idSchema,
    a: linkEndSchema,
    b: linkEndSchema,
    kind: z.enum(LINK_KINDS),
    medium: z.enum(LINK_MEDIA),
    role: z.enum(['primary', 'backup']).optional(),
    /** vpn only: the WAN link this tunnel rides on */
    via: idSchema.optional(),
    speed: z.string().optional(),
    vlans: z.array(vlanIdSchema).optional(),
    when: whenSchema.optional(),
  })
  .strict();

export const serviceSchema = z
  .object({
    id: idSchema,
    scope: z.enum(['site', 'global']),
    /** scope "site": the device with one of these roles in the same site */
    providerRoles: z.array(idSchema).optional(),
    /** scope "global": fixed devices */
    providers: z.array(idSchema).optional(),
    redundancy: z.enum(['any', 'all']).default('any'),
    upstream: z.array(idSchema).optional(),
  })
  .strict();

const ruleFrom = z.union([vlanIdSchema, z.literal('any')]);
const ruleTo = z.union([vlanIdSchema, z.literal('any'), z.enum(NAMED_TARGETS)]);

export const accessRuleSchema = z
  .object({
    id: idSchema,
    from: z.array(ruleFrom).min(1),
    to: z.array(ruleTo).min(1),
    action: z.enum(['permit', 'deny']),
    /** A permit with services only allows those ("limited" access) */
    serviceKeys: z.array(keySchema).optional(),
    descriptionKey: keySchema,
  })
  .strict();

export const accessPolicySchema = z
  .object({
    defaultAction: z.enum(['permit', 'deny']),
    enforcedOnRoles: z.array(idSchema).default([]),
    /** Evaluated top to bottom, first deciding match wins */
    rules: z.array(accessRuleSchema),
  })
  .strict();

const templateSchema = z.object({ zones: z.array(zoneSchema), devices: z.array(deviceSchema), links: z.array(linkSchema) }).strict();

export const topologySchema = z
  .object({
    meta: z.object({ version: z.string(), updated: z.string() }).strict(),
    vlans: z.array(vlanSchema),
    sites: z.array(siteSchema),
    templates: z.record(templateSchema).default({}),
    zones: z.array(zoneSchema).default([]),
    devices: z.array(deviceSchema).default([]),
    links: z.array(linkSchema).default([]),
    services: z.array(serviceSchema).default([]),
    accessPolicy: accessPolicySchema,
  })
  .strict();

export const AUDIENCES = ['reception', 'vets', 'backoffice', 'owners', 'it'] as const;

/** A service id, or "role:<role id>": a device of that role (same site first, otherwise anywhere) must be reachable */
const needSchema = z.string().regex(/^(role:)?[A-Za-z0-9._-]+$/);

export const capabilitySchema = z
  .object({
    id: idSchema,
    /** Who notices when it fails */
    audience: z.enum(AUDIENCES),
    needs: z.array(needSchema).default([]),
  })
  .strict();

export const roleSchema = z
  .object({
    id: idSchema,
    /** Icon name, see components/map/roleIcons.ts */
    icon: z.string().min(1),
    layer: z.enum(ROLE_LAYERS),
    /** Passes traffic on (firewall, switch, access point, host, provider). Endpoints never do. */
    forwards: z.boolean().default(false),
    /** Keeps delivering power when its own source is gone (UPS) */
    battery: z.boolean().default(false),
    /** What the device needs to be on the network at all (service ids) */
    needs: z.array(needSchema).default([]),
    /** What people do with the device; each capability has its own needs on top */
    capabilities: z.array(capabilitySchema).default([]),
  })
  .strict();

export const rolesSchema = z.object({ roles: z.array(roleSchema) }).strict();

// --- Types -------------------------------------------------------------------------

export type RawTopology = z.infer<typeof topologySchema>;
export type Vlan = z.infer<typeof vlanSchema>;
export type Site = z.infer<typeof siteSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type AccessRule = z.infer<typeof accessRuleSchema>;
export type AccessPolicy = z.infer<typeof accessPolicySchema>;
export type Role = z.infer<typeof roleSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type LinkKind = (typeof LINK_KINDS)[number];
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** After expansion every zone and device belongs to a site and `when` is gone. */
export type Zone = Omit<z.infer<typeof zoneSchema>, 'when' | 'site'> & { site: string };
export type Device = Omit<z.infer<typeof deviceSchema>, 'when' | 'site'> & { site: string };
export type Link = Omit<z.infer<typeof linkSchema>, 'when'>;

export interface Topology {
  meta: RawTopology['meta'];
  vlans: Vlan[];
  sites: Site[];
  zones: Zone[];
  devices: Device[];
  links: Link[];
  services: Service[];
  accessPolicy: AccessPolicy;
}
