/**
 * vSphere HA, reduced to what the failure simulator needs: after hosts fail, which VMs are
 * restarted where, and which ones do not fit.
 *
 * Rules:
 *  - VMs on a healthy host stay where they are (no outage).
 *  - VMs of failed hosts are restarted in order of restart priority (1 first).
 *  - A VM goes to the host with the most free memory that has room for it.
 *  - Anti-affinity is respected when possible; with too few hosts left the VM is started anyway
 *    (availability beats separation).
 *  - What does not fit stays off.
 * Module F (HA lab) builds on the same function and adds CPU, DRS and admission control.
 */
import { z } from 'zod';

export const clusterSchema = z
  .object({
    illustrative: z.boolean().optional(),
    hosts: z.array(z.object({ id: z.string(), cpuCores: z.number().int().positive(), ramGb: z.number().positive() }).strict()).min(1),
    vms: z.array(z.object({ id: z.string(), vcpu: z.number().int().positive(), ramGb: z.number().positive(), restartPriority: z.number().int().min(1).max(4) }).strict()),
    rules: z.array(z.object({ type: z.literal('anti-affinity'), vms: z.array(z.string()).min(2) }).strict()).default([]),
    storage: z.object({ type: z.enum(['shared-array', 'vsan']), controllers: z.array(z.string()).min(1) }).strict(),
    /** Illustrative timing of an HA restart and a vMotion, in seconds */
    ha: z.object({ detectionSec: z.number().positive(), waveGapSec: z.number().positive(), bootSec: z.number().positive(), vmotionSec: z.number().positive() }).strict(),
    /** DRS recommends moves when host memory use differs by more than this many percentage points */
    drs: z.object({ thresholdPct: z.number().positive().max(100) }).strict(),
    /** Single-point-of-failure table; texts at ha.spof.<id>.component|how|fails. "try" breaks it in the lab. */
    spof: z.array(z.object({ id: z.string(), try: z.object({ kind: z.enum(['device', 'link']), id: z.string() }).strict().optional() }).strict()).default([]),
    /** The "before" picture: services that once had a physical server each (service ids) */
    before: z.array(z.string()).default([]),
  })
  .strict();

export type ClusterData = z.infer<typeof clusterSchema>;

export interface Placement {
  /** Host the VM runs on now; undefined = not running */
  host?: string;
  restarted: boolean;
  reason?: 'no-host' | 'no-capacity';
}

/**
 * @param initial  vm id → host id the VM started on
 * @param hostOk   host is running and reaches the storage
 */
export function placeVms(cluster: ClusterData, initial: ReadonlyMap<string, string>, hostOk: (hostId: string) => boolean): Map<string, Placement> {
  const result = new Map<string, Placement>();
  const hosts = cluster.hosts.filter((h) => hostOk(h.id));
  const free = new Map(hosts.map((h) => [h.id, h.ramGb]));
  const on = new Map<string, string[]>(hosts.map((h) => [h.id, []]));
  const partners = (vm: string) => cluster.rules.filter((r) => r.vms.includes(vm)).flatMap((r) => r.vms.filter((v) => v !== vm));

  const displaced: ClusterData['vms'] = [];
  for (const vm of cluster.vms) {
    const host = initial.get(vm.id);
    if (host !== undefined && free.has(host)) {
      free.set(host, free.get(host)! - vm.ramGb);
      on.get(host)!.push(vm.id);
      result.set(vm.id, { host, restarted: false });
    } else {
      displaced.push(vm);
    }
  }

  displaced.sort((a, b) => a.restartPriority - b.restartPriority || b.ramGb - a.ramGb || a.id.localeCompare(b.id));
  for (const vm of displaced) {
    if (hosts.length === 0) {
      result.set(vm.id, { restarted: false, reason: 'no-host' });
      continue;
    }
    const fits = hosts.filter((h) => free.get(h.id)! >= vm.ramGb);
    const apart = fits.filter((h) => !partners(vm.id).some((p) => on.get(h.id)!.includes(p)));
    const pool = apart.length ? apart : fits;
    const target = [...pool].sort((a, b) => free.get(b.id)! - free.get(a.id)! || a.id.localeCompare(b.id))[0];
    if (!target) {
      result.set(vm.id, { restarted: false, reason: 'no-capacity' });
      continue;
    }
    free.set(target.id, free.get(target.id)! - vm.ramGb);
    on.get(target.id)!.push(vm.id);
    result.set(vm.id, { host: target.id, restarted: true });
  }
  return result;
}
