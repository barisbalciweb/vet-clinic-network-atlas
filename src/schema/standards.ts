/**
 * Module E – standardization and automation. Schema of standards.json and the artefacts computed
 * from the topology:
 *   siteConfig    the configuration of a clinic, rendered from the one site template
 *   diffLines     which lines differ between two clinics (only the site variables should)
 *   ansibleRun    a simulated playbook run over all clinic switches, with ok / changed / failed
 *
 * The configuration is a readable, vendor-neutral sketch, not the syntax of a real product.
 */
import { z } from 'zod';
import type { Issue } from './validateI18n';
import type { Topology } from './topology.schema';
import type { TopologyIndex } from '../utils/topologyIndex';
import { gatewayOf, subnetPrefix } from '../utils/ip';

const id = z.string().regex(/^[a-z0-9-]+$/);

export const standardsSchema = z
  .object({
    illustrative: z.boolean(),
    kitReasons: z.array(id).min(1),
    config: z
      .object({ hqPeers: z.array(z.string()).min(1), snmp: z.string(), syslog: z.string(), ntp: z.array(z.string()).min(1) })
      .strict(),
    firmware: z.object({ current: z.string(), target: z.string(), observeHours: z.number().positive() }).strict(),
    rollout: z.array(z.object({ id, sites: z.array(id).min(1) }).strict()).min(1),
    ansible: z
      .object({
        /** Result per switch in a healthy network; a switch that is off in the simulator is "unreachable" */
        outcomes: z.record(z.enum(['ok', 'changed', 'failed'])),
        /** Why the failing host failed (text key std.ansible.failure.<id>) */
        failure: id,
      })
      .strict(),
    zeroTouch: z.array(id).min(1),
    comparison: z.array(z.object({ id, without: z.number().nonnegative(), with: z.number().nonnegative() }).strict()).min(1),
  })
  .strict();

export type Standards = z.infer<typeof standardsSchema>;

export function validateStandards(raw: unknown, index: TopologyIndex): { issues: Issue[]; data?: Standards; keys: Array<{ key: string; where: string }> } {
  const issues: Issue[] = [];
  const keys: Array<{ key: string; where: string }> = [];
  const err = (path: string, message: string) => issues.push({ severity: 'error', path: `standards.json › ${path}`, message });
  const parsed = standardsSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) err(i.path.join(' › ') || '(root)', i.message);
    return { issues, keys };
  }
  const data = parsed.data;
  const need = (key: string, where: string) => keys.push({ key, where: `standards.json › ${where}` });
  for (const r of data.kitReasons) need(`std.kit.reason.${r}`, 'kitReasons');
  for (const s of data.zeroTouch) {
    need(`std.zero.${s}.title`, 'zeroTouch');
    need(`std.zero.${s}.text`, 'zeroTouch');
  }
  for (const c of data.comparison) need(`std.compare.${c.id}`, 'comparison');
  for (const r of data.rollout) {
    need(`std.dash.stage.${r.id}`, 'rollout');
    for (const s of r.sites) if (index.sites.get(s)?.kind !== 'clinic') err(`rollout "${r.id}"`, `"${s}" is not a clinic`);
  }
  const clinics = index.topology.sites.filter((s) => s.kind === 'clinic').map((s) => s.id);
  const inRollout = data.rollout.flatMap((r) => r.sites);
  for (const c of clinics) if (!inRollout.includes(c)) err('rollout', `Clinic "${c}" is in no rollout stage`);
  for (const sw of Object.keys(data.ansible.outcomes)) if (index.devices.get(sw)?.role !== 'access-switch') err('ansible › outcomes', `"${sw}" is not a clinic switch`);
  need(`std.ansible.failure.${data.ansible.failure}.reason`, 'ansible');
  need(`std.ansible.failure.${data.ansible.failure}.fix`, 'ansible');
  return { issues, data, keys };
}

// --- Site configuration from the template ----------------------------------------------------

export function siteConfig(topo: Topology, siteId: string, std: Standards, pool: { from: number; to: number }): string[] {
  const site = topo.sites.find((s) => s.id === siteId)!;
  const n = site.number ?? 0;
  const fw = topo.devices.find((d) => d.site === siteId && d.role === 'clinic-firewall');
  const lines = [
    `# clinic template v3 · site=${site.id} code=${site.code} n=${n}`,
    `hostname ${fw?.name ?? `${site.code}-FW-01`}`,
    `wan1 role=primary  failover=wan2 (lte)`,
    ...std.config.hqPeers.map((p, i) => `vpn hub-${i + 1} peer ${p}  local-id ${site.code.toLowerCase()}-fw.pfotenwerk.example`),
    `vpn protected 10.${n}.0.0/16 <-> 10.0.0.0/16`,
  ];
  for (const v of topo.vlans.filter((x) => x.scope === 'all')) {
    lines.push(`vlan ${v.id} name ${v.name}  gateway ${gatewayOf(n, v.id)}/24`);
    if (v.dhcp) lines.push(`  dhcp ${subnetPrefix(n, v.id)}${pool.from}-${pool.to}  dns ${gatewayOf(n, v.id)}`);
  }
  lines.push(`dns forward pfotenwerk.example -> ${std.config.ntp.join(', ')}`);
  lines.push(`ntp ${std.config.ntp.join(' ')}`);
  lines.push(`snmp v3 host ${std.config.snmp} user monitor`);
  lines.push(`syslog ${std.config.syslog}`);
  lines.push(`policy clinic-default  # ${topo.accessPolicy.rules.length} rules, default deny`);
  return lines;
}

/** Index of every line that differs (both configs come from the same template, so they line up). */
export function diffLines(a: string[], b: string[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.add(i);
  return out;
}

// --- Ansible ---------------------------------------------------------------------------------

export type AnsibleOutcome = 'ok' | 'changed' | 'failed' | 'unreachable';

export interface AnsibleHost {
  device: string;
  outcome: AnsibleOutcome;
  ok: number;
  changed: number;
}

export const ANSIBLE_TASKS = ['vlans', 'snmp', 'ntp', 'syslog'] as const;

/**
 * The run over every clinic switch of a live site. A switch that is off (or cut off) in the
 * simulator is unreachable; the others get the outcome from the data.
 */
export function ansibleRun(std: Standards, index: TopologyIndex, liveSites: (site: string) => boolean, reachable: (device: string) => boolean): AnsibleHost[] {
  return index.topology.devices
    .filter((d) => d.role === 'access-switch' && index.sites.get(d.site)?.kind === 'clinic' && liveSites(d.site))
    .map((d) => {
      const base = std.ansible.outcomes[d.id] ?? 'ok';
      const outcome: AnsibleOutcome = !reachable(d.id) ? 'unreachable' : base;
      const changed = outcome === 'changed' ? 2 : 0;
      const ok = outcome === 'unreachable' ? 0 : outcome === 'failed' ? 1 : ANSIBLE_TASKS.length + 1 - changed;
      return { device: d.id, outcome, ok, changed };
    });
}

/** The ansible-playbook output as it would scroll by, in its usual format. */
export function ansibleOutput(hosts: AnsibleHost[], names: (device: string) => string): string[] {
  const pad = (s: string, n: number) => s + '*'.repeat(Math.max(3, n - s.length));
  const lines = [pad('PLAY [clinic switch baseline] ', 72), ''];
  const tasks = ['Gathering Facts', ...ANSIBLE_TASKS.map((t) => `baseline : ${t}`)];
  tasks.forEach((task, ti) => {
    lines.push(pad(`TASK [${task}] `, 72));
    for (const h of hosts) {
      const n = names(h.device);
      if (h.outcome === 'unreachable') {
        if (ti === 0) lines.push(`fatal: [${n}]: UNREACHABLE! => {"msg": "Connection timed out"}`);
      } else if (h.outcome === 'failed') {
        if (ti === 0) lines.push(`fatal: [${n}]: FAILED! => {"msg": "Authentication failed"}`);
      } else {
        const isChanged = h.outcome === 'changed' && (task.endsWith('vlans') || task.endsWith('snmp'));
        lines.push(`${isChanged ? 'changed' : 'ok'}: [${n}]`);
      }
    }
    lines.push('');
  });
  lines.push(pad('PLAY RECAP ', 72));
  for (const h of hosts) {
    const n = names(h.device).padEnd(14);
    lines.push(`${n}: ok=${h.ok}  changed=${h.changed}  unreachable=${h.outcome === 'unreachable' ? 1 : 0}  failed=${h.outcome === 'failed' ? 1 : 0}`);
  }
  return lines;
}

export const ANSIBLE_INVENTORY = `# inventory/clinics.yml
clinics:
  vars:
    ansible_network_os: generic_switch
    snmp_host: 10.0.70.30
    ntp_servers: [10.0.70.11, 10.0.70.12]
  children:
    berlin:   { hosts: { ber-sw1: { n: 1 }, ber-sw2: { n: 1 } } }
    hamburg:  { hosts: { hh-sw1: { n: 2 } } }
    muenchen: { hosts: { muc-sw1: { n: 3 } } }`;

export const ANSIBLE_PLAYBOOK = `# baseline.yml
- name: clinic switch baseline
  hosts: clinics
  gather_facts: true
  tasks:
    - name: vlans
      switch_vlans:
        config: "{{ clinic_vlans }}"    # 10 20 30 40 50 60 100
    - name: snmp
      switch_snmp: { version: v3, host: "{{ snmp_host }}", user: monitor }
    - name: ntp
      switch_ntp: { servers: "{{ ntp_servers }}" }
    - name: syslog
      switch_syslog: { host: "{{ snmp_host }}" }`;
