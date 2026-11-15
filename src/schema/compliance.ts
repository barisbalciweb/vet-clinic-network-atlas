/**
 * Modules G and H: data protection and monitoring.
 *
 *   privacyByDevice  which protective measures apply to a device (for the map layer)
 *   statusBoard      the monitoring view of the simulated network: per site WAN, VPN, Wi-Fi and key
 *                    devices; at HQ the cluster, storage, backup and certificates; plus the alerts
 *
 * Texts by convention:
 *   privacy.measure.<id>.title | example, privacy.category.<id>, privacy.location.<id>,
 *   privacy.activity.<id>, privacy.day1.<id>, privacy.retention.<id>
 *   mon.warn.<id>, mon.oncall.<id>.title | text, mon.release.step.<id>.title | text, mon.release.check.<id>
 */
import { z } from 'zod';
import type { Issue } from './validateI18n';
import type { TopologyIndex } from '../utils/topologyIndex';
import type { Device } from './topology.schema';
import type { SimulationResult } from '../engine/types';
import type { ActiveFault, FaultData } from '../engine/explain';

const id = z.string().regex(/^[a-z0-9-]+$/);

export const privacySchema = z
  .object({
    categories: z.array(id).min(1),
    locations: z.array(id).min(1),
    measures: z.array(
      z
        .object({
          id,
          location: id,
          categories: z.array(id).min(1),
          activity: z.enum(['stored', 'processed', 'transmitted']),
          /** Devices of these roles show the measure on the map; organisational measures have none */
          roles: z.array(id).optional(),
        })
        .strict(),
    ),
    day1: z.array(id).min(1),
    retention: z.array(id).min(1),
  })
  .strict();

export const monitoringSchema = z
  .object({
    illustrative: z.boolean(),
    /** Roles whose devices are listed as key devices on the status board */
    keyRoles: z.array(id).min(1),
    certificates: z.array(z.object({ id, service: id, daysLeft: z.number().int() }).strict()),
    /** Certificates expiring within this many days are a warning */
    warnDays: z.number().int().positive(),
    earlyWarnings: z.array(z.object({ id, device: id, value: z.number(), limit: z.number() }).strict()),
    onCall: z.object({ scenario: id, steps: z.array(z.object({ id, time: z.string() }).strict()).min(1) }).strict(),
    release: z.object({ steps: z.array(id).min(1), checks: z.array(id).min(1) }).strict(),
  })
  .strict();

export type Privacy = z.infer<typeof privacySchema>;
export type Measure = Privacy['measures'][number];
export type Monitoring = z.infer<typeof monitoringSchema>;

type Keys = Array<{ key: string; where: string }>;

export function validateCompliance(rawPrivacy: unknown, rawMonitoring: unknown, index: TopologyIndex, faults: FaultData): { issues: Issue[]; privacy?: Privacy; monitoring?: Monitoring; keys: Keys } {
  const issues: Issue[] = [];
  const keys: Keys = [];
  const err = (path: string, message: string) => issues.push({ severity: 'error', path, message });
  const need = (key: string, where: string) => keys.push({ key, where });
  const p = privacySchema.safeParse(rawPrivacy);
  const m = monitoringSchema.safeParse(rawMonitoring);
  if (!p.success) for (const i of p.error.issues) err(`privacy.json › ${i.path.join(' › ') || '(root)'}`, i.message);
  if (!m.success) for (const i of m.error.issues) err(`monitoring.json › ${i.path.join(' › ') || '(root)'}`, i.message);
  if (!p.success || !m.success) return { issues, keys };
  const privacy = p.data;
  const monitoring = m.data;

  for (const c of privacy.categories) need(`privacy.category.${c}`, 'privacy.json › categories');
  for (const l of privacy.locations) need(`privacy.location.${l}`, 'privacy.json › locations');
  for (const a of ['stored', 'processed', 'transmitted']) need(`privacy.activity.${a}`, 'privacy.json');
  const seen = new Set<string>();
  for (const ms of privacy.measures) {
    const at = `privacy.json › measure "${ms.id}"`;
    if (seen.has(ms.id)) err(at, 'Id is used more than once');
    seen.add(ms.id);
    if (!privacy.locations.includes(ms.location)) err(at, `Location "${ms.location}" is not listed`);
    for (const c of ms.categories) if (!privacy.categories.includes(c)) err(at, `Category "${c}" is not listed`);
    for (const r of ms.roles ?? []) if (!index.roles.has(r)) err(at, `Role "${r}" is not defined`);
    need(`privacy.measure.${ms.id}.title`, at);
    need(`privacy.measure.${ms.id}.example`, at);
  }
  for (const d of privacy.day1) need(`privacy.day1.${d}`, 'privacy.json › day1');
  for (const r of privacy.retention) need(`privacy.retention.${r}`, 'privacy.json › retention');

  for (const r of monitoring.keyRoles) if (!index.roles.has(r)) err('monitoring.json › keyRoles', `Role "${r}" is not defined`);
  for (const c of monitoring.certificates) if (!index.services.has(c.service)) err(`monitoring.json › certificate "${c.id}"`, `Service "${c.service}" is not defined`);
  for (const w of monitoring.earlyWarnings) {
    if (!index.devices.has(w.device)) err(`monitoring.json › warning "${w.id}"`, `Device "${w.device}" does not exist`);
    need(`mon.warn.${w.id}`, `monitoring.json › warning "${w.id}"`);
  }
  if (!faults.scenarios.some((s) => s.id === monitoring.onCall.scenario)) err('monitoring.json › onCall', `Scenario "${monitoring.onCall.scenario}" does not exist`);
  for (const s of monitoring.onCall.steps) {
    need(`mon.oncall.${s.id}.title`, 'monitoring.json › onCall');
    need(`mon.oncall.${s.id}.text`, 'monitoring.json › onCall');
  }
  for (const s of monitoring.release.steps) {
    need(`mon.release.step.${s}.title`, 'monitoring.json › release');
    need(`mon.release.step.${s}.text`, 'monitoring.json › release');
  }
  for (const c of monitoring.release.checks) need(`mon.release.check.${c}`, 'monitoring.json › release');
  return { issues, privacy, monitoring, keys };
}

/** Measures per device, from the roles listed in privacy.json */
export function privacyByDevice(privacy: Privacy, index: TopologyIndex): Map<string, Measure[]> {
  const out = new Map<string, Measure[]>();
  for (const d of index.topology.devices) {
    const ms = privacy.measures.filter((m) => m.roles?.includes(d.role));
    if (ms.length) out.set(d.id, ms);
  }
  return out;
}

// --- Status board ----------------------------------------------------------------------------

export type Health = 'ok' | 'warn' | 'bad';
const worst = (...h: Health[]): Health => (h.includes('bad') ? 'bad' : h.includes('warn') ? 'warn' : 'ok');

export interface SiteStatusRow {
  site: string;
  wan: { value: 'primary' | 'backup' | 'offline'; health: Health };
  vpn?: { value: 'primary' | 'backup' | 'down'; health: Health };
  wifi: { up: number; total: number; health: Health };
  key: { down: string[]; degraded: string[]; health: Health };
  health: Health;
}

export interface HqStatus {
  hosts: { up: number; total: number; health: Health };
  vms: { running: number; total: number; restarted: number; health: Health };
  storage: { up: number; total: number; health: Health };
  backup: Health;
  certs: Array<{ id: string; service: string; daysLeft: number; expired: boolean; health: Health }>;
}

export interface Alert {
  health: Exclude<Health, 'ok'>;
  key: string;
  params: Record<string, string | number>;
}

export interface StatusBoard {
  sites: SiteStatusRow[];
  hq: HqStatus;
  alerts: Alert[];
}

export function statusBoard(result: SimulationResult, index: TopologyIndex, monitoring: Monitoring, liveSites: string[], active: ActiveFault[]): StatusBoard {
  const state = (d: Device) => result.devices[d.id];
  const isUp = (d: Device) => state(d)?.on && state(d)?.state !== 'down';
  const alerts: Alert[] = [];

  const sites: SiteStatusRow[] = liveSites.map((site) => {
    const s = result.sites[site];
    const devices = index.devicesOfSite(site);
    const wanValue = s?.wan ?? 'offline';
    const wan = { value: wanValue, health: (wanValue === 'primary' ? 'ok' : wanValue === 'backup' ? 'warn' : 'bad') as Health };
    const vpn = s?.vpn ? { value: s.vpn, health: (s.vpn === 'primary' ? 'ok' : s.vpn === 'backup' ? 'warn' : 'bad') as Health } : undefined;
    const aps = devices.filter((d) => d.role === 'access-point');
    const apsUp = aps.filter(isUp).length;
    const wifi = { up: apsUp, total: aps.length, health: (apsUp === aps.length ? 'ok' : apsUp === 0 ? 'bad' : 'warn') as Health };
    const keyDevices = devices.filter((d) => monitoring.keyRoles.includes(d.role));
    const down = keyDevices.filter((d) => !isUp(d)).map((d) => d.id);
    const degraded = keyDevices.filter((d) => isUp(d) && state(d)?.state === 'degraded').map((d) => d.id);
    const key = { down, degraded, health: (down.length ? 'bad' : degraded.length ? 'warn' : 'ok') as Health };

    if (wan.health !== 'ok') alerts.push({ health: wan.health as Alert['health'], key: `mon.alert.wan.${wanValue}`, params: { site } });
    if (vpn && vpn.health !== 'ok') alerts.push({ health: vpn.health as Alert['health'], key: `mon.alert.vpn.${vpn.value}`, params: { site } });
    if (wifi.health !== 'ok' && aps.length) alerts.push({ health: wifi.health as Alert['health'], key: 'mon.alert.wifi', params: { site, up: apsUp, total: aps.length } });
    for (const d of down) alerts.push({ health: 'bad', key: 'mon.alert.down', params: { device: d } });
    return { site, wan, vpn, wifi, key, health: worst(wan.health, vpn?.health ?? 'ok', wifi.health, key.health) };
  });

  // HQ cluster, storage, backup
  const hosts = index.topology.devices.filter((d) => d.role === 'esxi-host');
  const hostsUp = hosts.filter((d) => state(d)?.on).length;
  const vms = index.topology.devices.filter((d) => d.runsOn);
  const vmsRunning = vms.filter((d) => state(d)?.on).length;
  const restarted = vms.filter((d) => state(d)?.restarted).length;
  const ctls = index.topology.devices.filter((d) => d.role === 'storage-controller');
  const ctlsUp = ctls.filter((d) => state(d)?.on).length;
  const backupDevice = index.topology.devices.find((d) => d.role === 'vm-backup');
  const offsite = result.capabilities.find((c) => c.device === backupDevice?.id && c.capability === 'offsite-copy');
  const backup: Health = !backupDevice || !state(backupDevice)?.on ? 'bad' : offsite?.state === 'down' ? 'bad' : offsite?.state === 'degraded' ? 'warn' : 'ok';

  const hq: HqStatus = {
    hosts: { up: hostsUp, total: hosts.length, health: hostsUp === hosts.length ? 'ok' : hostsUp >= hosts.length - 1 ? 'warn' : 'bad' },
    vms: { running: vmsRunning, total: vms.length, restarted, health: vmsRunning < vms.length ? 'bad' : restarted ? 'warn' : 'ok' },
    storage: { up: ctlsUp, total: ctls.length, health: ctlsUp === ctls.length ? 'ok' : ctlsUp > 0 ? 'warn' : 'bad' },
    backup,
    certs: monitoring.certificates.map((c) => {
      const expired = active.some((a) => a.fault.variant === 'cert-expired' && a.fault.target.kind === 'service' && a.fault.target.id === c.service);
      return { ...c, expired, health: expired ? 'bad' : c.daysLeft <= monitoring.warnDays ? 'warn' : 'ok' };
    }),
  };
  if (hq.hosts.health !== 'ok') alerts.push({ health: hq.hosts.health as Alert['health'], key: 'mon.alert.hosts', params: { up: hostsUp, total: hosts.length } });
  if (vmsRunning < vms.length) alerts.push({ health: 'bad', key: 'mon.alert.vms', params: { count: vms.length - vmsRunning } });
  else if (restarted) alerts.push({ health: 'warn', key: 'mon.alert.restarted', params: { count: restarted } });
  if (hq.storage.health !== 'ok') alerts.push({ health: hq.storage.health as Alert['health'], key: 'mon.alert.storage', params: { up: ctlsUp, total: ctls.length } });
  if (backup !== 'ok') alerts.push({ health: backup, key: 'mon.alert.backup', params: {} });
  for (const c of hq.certs) {
    if (c.expired) alerts.push({ health: 'bad', key: 'mon.alert.certExpired', params: { service: c.service } });
    else if (c.health === 'warn') alerts.push({ health: 'warn', key: 'mon.alert.certSoon', params: { service: c.service, days: c.daysLeft } });
  }
  alerts.sort((a, b) => (a.health === b.health ? 0 : a.health === 'bad' ? -1 : 1));
  return { sites, hq, alerts };
}
