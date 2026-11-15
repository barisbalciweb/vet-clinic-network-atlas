/**
 * One test per must-have scenario of the brief (section 5, Module B), on the real data files.
 * Each test states what a clinic would notice, not how the engine computes it.
 */
import { describe, expect, it } from 'vitest';
import { CLUSTER, ROLES, TOPOLOGY } from '../data';
import { placeVms } from './cluster';
import { simulate } from './simulate';
import type { Fault, Quality, SimulationResult } from './types';

const run = (...faults: Fault[]) => simulate(TOPOLOGY, faults, { roles: ROLES, cluster: CLUSTER });
const off = (id: string): Fault => ({ type: 'power-off', target: { kind: 'device', id } });
const cut = (id: string): Fault => ({ type: 'link-cut', target: { kind: 'link', id } });

/** State of one capability of one device, e.g. cap(r, 'hh-pos1', 'pay') */
function cap(r: SimulationResult, device: string, capability: string): Quality {
  const found = r.capabilities.find((c) => c.device === device && c.capability === capability);
  if (!found) throw new Error(`No capability ${capability} on ${device}`);
  return found.state;
}
const cause = (r: SimulationResult, device: string, capability: string) => r.capabilities.find((c) => c.device === device && c.capability === capability)!.cause;
const kinds = (r: SimulationResult) => r.chain.map((e) => e.kind);

describe('healthy network', () => {
  const r = run();

  it('everything works and nothing is reported', () => {
    expect(r.healthy).toBe(true);
    expect(r.affected).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.capabilities.every((c) => c.state === 'up')).toBe(true);
  });

  it('clinics run on their primary line and primary tunnel, backups stand by', () => {
    expect(r.sites.hh).toEqual({ wan: 'primary', vpn: 'primary', state: 'up' });
    expect(r.sites.hq).toEqual({ wan: 'primary', state: 'up' });
    expect(r.links['hh-wan1'].state).toBe('up');
    expect(r.links['hh-wan2'].state).toBe('standby');
    expect(r.links['vpn-hh-2'].state).toBe('standby');
  });

  it('leaves the planned clinic out', () => {
    expect(r.sites.muc).toBeUndefined();
    expect(r.devices['muc-fw']).toBeUndefined();
    expect(r.links['vpn-muc-1'].state).toBe('planned');
  });
});

describe('clinic access switch off', () => {
  const r = run(off('hh-sw1'));

  it('takes down everything wired in that clinic', () => {
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('down');
    expect(cap(r, 'hh-pos1', 'pay')).toBe('down');
    expect(cap(r, 'hh-phone1', 'calls')).toBe('down');
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('down');
    expect(r.devices['hh-mfp'].state).toBe('down');
  });

  it('takes the Wi-Fi with it, because the access points get their power from the switch', () => {
    expect(r.devices['hh-ap1'].on).toBe(false);
    expect(r.devices['hh-ap1'].cause).toMatchObject({ reason: 'no-power', via: 'hh-sw1', fault: 0 });
    expect(cap(r, 'hh-tr1-mac', 'records')).toBe('down');
    expect(cap(r, 'hh-guest', 'guest-internet')).toBe('down');
  });

  it('still lets the X-ray machine take images locally', () => {
    expect(cap(r, 'hh-xray-pc', 'take-xray')).toBe('up');
  });

  it('leaves the line, the tunnel and the other clinics alone', () => {
    expect(r.sites.hh).toMatchObject({ wan: 'primary', vpn: 'primary' });
    expect(cap(r, 'ber-pos1', 'pay')).toBe('up');
    expect(r.affected.every((a) => a.site === 'hh')).toBe(true);
  });

  it('blames the switch', () => {
    expect(cause(r, 'hh-pos1', 'pay')).toMatchObject({ fault: 0, via: 'hh-sw1' });
  });

  it('does not claim that a service failed: the devices are cut off, the services are fine', () => {
    expect(r.capabilities.find((c) => c.device === 'hh-pos1')).toMatchObject({ offNetwork: true });
    expect(r.chain.filter((e) => e.kind === 'service-down')).toEqual([]);
  });
});

describe('clinic primary WAN cut', () => {
  const r = run(cut('hh-wan1'));

  it('fails over to LTE and brings the tunnel back over the backup', () => {
    expect(r.sites.hh).toEqual({ wan: 'backup', vpn: 'backup', state: 'degraded' });
    expect(r.links['hh-wan1'].state).toBe('down');
    expect(r.links['hh-wan2']).toMatchObject({ state: 'degraded', carrying: true });
    expect(r.links['vpn-hh-1'].state).toBe('down');
    expect(r.links['vpn-hh-2']).toMatchObject({ state: 'degraded', carrying: true });
    expect(kinds(r)).toEqual(expect.arrayContaining(['wan-failover', 'vpn-failover']));
  });

  it('keeps everything working, but slower: X-ray uploads, payments, practice software', () => {
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('degraded');
    expect(cap(r, 'hh-pos1', 'pay')).toBe('degraded');
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('degraded');
    expect(cause(r, 'hh-xray-pc', 'archive-images')).toMatchObject({ fault: 0, reason: 'backup-path' });
    expect(r.affected.some((a) => a.state === 'down')).toBe(false);
  });

  it('does not touch local printing', () => {
    expect(cap(r, 'hh-rec-mac1', 'print-receipt')).toBe('up');
  });
});

describe('clinic primary WAN and LTE cut', () => {
  const r = run(cut('hh-wan1'), cut('hh-wan2'));

  it('takes the clinic offline', () => {
    expect(r.sites.hh).toEqual({ wan: 'offline', vpn: 'down', state: 'down' });
    expect(kinds(r)).toEqual(expect.arrayContaining(['site-offline', 'vpn-down']));
  });

  it('stops everything that needs the internet or HQ', () => {
    expect(cap(r, 'hh-pos1', 'pay')).toBe('down');
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('down');
    expect(cap(r, 'hh-rec-mac1', 'files')).toBe('down');
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('down');
    expect(cap(r, 'hh-phone1', 'calls')).toBe('down');
    expect(cap(r, 'hh-guest', 'guest-internet')).toBe('down');
  });

  it('keeps what is local: printing, taking X-rays, lab analysis, ultrasound', () => {
    expect(cap(r, 'hh-rec-mac1', 'print-receipt')).toBe('up');
    expect(cap(r, 'hh-rec-mac1', 'print-label')).toBe('up');
    expect(cap(r, 'hh-office-mac', 'print-document')).toBe('up');
    expect(cap(r, 'hh-xray-pc', 'take-xray')).toBe('up');
    expect(cap(r, 'hh-lab1', 'run-analysis')).toBe('up');
    expect(cap(r, 'hh-us', 'scan')).toBe('up');
  });
});

describe('VPN tunnel down but internet up', () => {
  const r = run({ type: 'service-failure', variant: 'tunnel-down', target: { kind: 'service', id: 'vpn', site: 'hh' } });

  it('keeps card payments and the cloud practice software', () => {
    expect(r.sites.hh).toMatchObject({ wan: 'primary', vpn: 'down' });
    expect(cap(r, 'hh-pos1', 'pay')).toBe('up');
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('up');
    expect(cap(r, 'hh-phone1', 'calls')).toBe('up');
  });

  it('loses the image archive, the file server and lab transfer', () => {
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('down');
    expect(cap(r, 'hh-tr1-mac', 'view-images')).toBe('down');
    expect(cap(r, 'hh-rec-mac1', 'files')).toBe('down');
    expect(cap(r, 'hh-lab1', 'send-results')).toBe('down');
    expect(cause(r, 'hh-rec-mac1', 'files')).toMatchObject({ fault: 0 });
  });

  it('does not affect Berlin', () => {
    expect(cap(r, 'ber-xray-pc', 'archive-images')).toBe('up');
  });
});

describe('DNS failure at HQ', () => {
  const dnsStops = (id: string): Fault => ({ type: 'service-failure', variant: 'dns-stopped', service: 'dns-internal', target: { kind: 'device', id } });

  it('one server: nobody notices, but the redundancy is gone', () => {
    const r = run(dnsStops('hq-dc1'));
    expect(r.affected).toEqual([]);
    expect(r.warnings).toContainEqual({ kind: 'service-redundancy-lost', subject: 'dns-internal', missing: ['hq-dc1'] });
  });

  it('both servers: internal names fail everywhere, internet names keep working', () => {
    const r = run(dnsStops('hq-dc1'), dnsStops('hq-dc2'));
    expect(cap(r, 'hh-rec-mac1', 'files')).toBe('down');
    expect(cap(r, 'ber-tr1-mac', 'view-images')).toBe('down');
    // Clinics resolve public names on their own firewall
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('up');
    expect(cap(r, 'hh-pos1', 'pay')).toBe('up');
    // The X-ray PC sends to the archive by address, not by name
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('up');
    expect(r.chain).toContainEqual(expect.objectContaining({ kind: 'service-down', subject: 'dns-internal', site: 'hh' }));
  });
});

describe('DHCP pool exhausted', () => {
  const exhausted = (vlan: number): Fault => ({ type: 'service-failure', variant: 'dhcp-exhausted', target: { kind: 'service', id: 'dhcp', site: 'hh', vlan } });

  it('guest VLAN: guests get no address, the clinic works normally', () => {
    const r = run(exhausted(100));
    expect(cap(r, 'hh-guest', 'guest-internet')).toBe('down');
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('up');
    expect(cap(r, 'hh-pos1', 'pay')).toBe('up');
    expect(r.affected.map((a) => a.audience)).toEqual(['owners']);
  });

  it('staff VLAN: the Macs are stuck, devices with fixed addresses are not', () => {
    const r = run(exhausted(20));
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('down');
    expect(cap(r, 'hh-tr1-mac', 'records')).toBe('down');
    expect(cap(r, 'hh-pos1', 'pay')).toBe('up');
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('up');
    expect(cap(r, 'ber-rec-mac1', 'records')).toBe('up');
    expect(cause(r, 'hh-rec-mac1', 'records')).toMatchObject({ fault: 0, reason: 'service-down' });
  });
});

describe('single access point off', () => {
  const r = run(off('hh-ap2'));

  it('leaves a coverage hole: its clients roam to the next access point', () => {
    expect(cap(r, 'hh-tr1-mac', 'records')).toBe('degraded');
    expect(cap(r, 'hh-tr2-mac', 'view-images')).toBe('degraded');
    expect(r.links['hh-w-tr1b']).toMatchObject({ state: 'degraded', carrying: true });
    expect(r.chain).toContainEqual(expect.objectContaining({ kind: 'roaming', subject: 'hh-tr1-mac', params: { ap: 'hh-ap1' } }));
  });

  it('does not disturb wired devices or guests on another access point', () => {
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('up');
    expect(cap(r, 'hh-guest', 'guest-internet')).toBe('up');
    // The only thing that is really down is the access point itself
    expect(r.affected.filter((a) => a.state === 'down').flatMap((a) => a.devices)).toEqual(['hh-ap2']);
  });
});

describe('single devices at reception', () => {
  it('reception Mac off: only that desk is affected', () => {
    const r = run(off('ber-rec-mac1'));
    expect(cap(r, 'ber-rec-mac1', 'records')).toBe('down');
    expect(cap(r, 'ber-rec-mac2', 'records')).toBe('up');
    expect(cap(r, 'ber-pos1', 'pay')).toBe('up');
    expect(new Set(r.affected.flatMap((a) => a.devices))).toEqual(new Set(['ber-rec-mac1']));
  });

  it('receipt printer off: no receipts, everything else at reception works', () => {
    const r = run(off('hh-rcpt1'));
    expect(cap(r, 'hh-rec-mac1', 'print-receipt')).toBe('down');
    expect(cap(r, 'hh-rec-mac1', 'print-label')).toBe('up');
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('up');
    expect(cap(r, 'hh-pos1', 'pay')).toBe('up');
    expect(cause(r, 'hh-rec-mac1', 'print-receipt')).toMatchObject({ fault: 0, via: 'hh-rcpt1' });
  });

  it('card terminal off: no card payments at that desk, cash and everything else still work', () => {
    const r = run(off('hh-pos1'));
    expect(cap(r, 'hh-pos1', 'pay')).toBe('down');
    expect(r.affected).toHaveLength(1);
    expect(r.affected[0]).toMatchObject({ site: 'hh', audience: 'reception', capability: 'pay', state: 'down' });
  });
});

describe('HQ: one component of a redundant pair fails', () => {
  it('one ESXi host: its VMs restart on the other two (short outage), the reserve is used up', () => {
    const r = run(off('hq-esx1'));
    expect(r.devices['hq-pacs']).toMatchObject({ on: true, restarted: true, state: 'degraded' });
    expect(r.devices['hq-pacs'].host).not.toBe('hq-esx1');
    expect(r.devices['hq-dc2'].restarted).toBeUndefined();
    // Restart, not zero downtime: the archive is briefly away ...
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('degraded');
    expect(cause(r, 'hh-xray-pc', 'archive-images')).toMatchObject({ fault: 0, reason: 'restarted' });
    // ... but login and DNS never were, because the second server sits on another host
    expect(cap(r, 'hh-rec-mac1', 'files')).toBe('up');
    expect(r.affected.some((a) => a.state === 'down')).toBe(false);
    expect(r.warnings).toContainEqual({ kind: 'capacity-reserve-used', subject: 'cluster', missing: ['hq-esx1'] });
    expect(kinds(r).filter((k) => k === 'vm-restarted')).toHaveLength(3);
  });

  it('one core switch: no outage, redundancy warning', () => {
    const r = run(off('hq-core1'));
    expect(r.affected).toEqual([]);
    expect(r.devices['hq-pacs']).toMatchObject({ on: true, state: 'up' });
    expect(r.warnings).toContainEqual({ kind: 'redundancy-lost', subject: 'hq-core-mlag', missing: ['hq-core1'] });
  });

  it('one firewall node: the other takes over, tunnels come back, redundancy warning', () => {
    const r = run(off('hq-fw1'));
    expect(r.affected.some((a) => a.state === 'down')).toBe(false);
    expect(r.sites.hq.wan).toBe('primary');
    expect(r.sites.hh.vpn).toBe('primary');
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('up');
    expect(r.warnings).toContainEqual({ kind: 'redundancy-lost', subject: 'hq-fw-ha', missing: ['hq-fw1'] });
  });

  it('ISP 1: HQ fails over to the second provider, clinic tunnels re-establish', () => {
    const r = run(off('hq-isp1'));
    expect(r.sites.hq.wan).toBe('backup');
    expect(r.links['hq-wan2a']).toMatchObject({ state: 'degraded', carrying: true });
    // The clinics still use their own primary line; the tunnel now ends at HQ's second address
    expect(r.sites.hh).toEqual({ wan: 'primary', vpn: 'primary', state: 'degraded' });
    expect(r.sites.ber.state).toBe('degraded');
    expect(r.links['vpn-hh-1'].state).toBe('degraded');
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('degraded');
    expect(cause(r, 'hh-xray-pc', 'archive-images')).toMatchObject({ fault: 0 });
    // Clinics keep their own internet
    expect(cap(r, 'hh-pos1', 'pay')).toBe('up');
    expect(r.affected.some((a) => a.state === 'down')).toBe(false);
  });

  it('one storage controller: no outage, redundancy warning', () => {
    const r = run(off('hq-ctl-a'));
    expect(r.affected).toEqual([]);
    expect(Object.values(r.devices).some((d) => d.restarted)).toBe(false);
    expect(r.warnings).toContainEqual({ kind: 'redundancy-lost', subject: 'hq-array', missing: ['hq-ctl-a'] });
  });

  it('one storage path: no outage', () => {
    const r = run(cut('hq-ctl-a-core1'), cut('hq-esx1-core2'));
    expect(r.affected).toEqual([]);
    expect(r.devices['hq-pacs']).toMatchObject({ on: true, state: 'up' });
  });

  it('one UPS: devices with two power supplies stay on, the firewall on that feed hands over', () => {
    const r = run(off('hq-ups-a'));
    expect(r.devices['hq-esx1'].on).toBe(true);
    expect(r.devices['hq-fw1'].on).toBe(false);
    expect(r.devices['hq-fw2'].on).toBe(true);
    expect(r.affected.some((a) => a.state === 'down' && a.site !== 'hq')).toBe(false);
  });
});

describe('HQ: both members of a pair fail', () => {
  it('both storage controllers: every VM stops', () => {
    const r = run(off('hq-ctl-a'), off('hq-ctl-b'));
    expect(r.devices['hq-pacs']).toMatchObject({ on: false, cause: { reason: 'no-storage' } });
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('down');
  });

  it('two hosts: the third restarts what fits, in order of priority', () => {
    const r = run(off('hq-esx1'), off('hq-esx2'));
    // Identity first; anti-affinity gives way when only one host is left
    expect(r.devices['hq-dc1']).toMatchObject({ on: true, host: 'hq-esx3' });
    expect(r.devices['hq-dc2']).toMatchObject({ on: true, host: 'hq-esx3' });
    // Priority 2, largest first: the archive still fits, the file server no longer does
    expect(r.devices['hq-pacs']).toMatchObject({ on: true, host: 'hq-esx3', restarted: true });
    expect(r.devices['hq-files']).toMatchObject({ on: false, cause: { reason: 'no-capacity' } });
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('degraded');
    expect(cap(r, 'hh-rec-mac1', 'files')).toBe('down');
  });
});

describe('HQ total power loss', () => {
  it('mains only: both UPS bridge it, nothing fails yet', () => {
    const r = run(off('hq-mains'));
    expect(r.affected).toEqual([]);
    expect(r.devices['hq-ups-a']).toMatchObject({ on: true, onBattery: true, state: 'degraded' });
    expect(r.warnings.filter((w) => w.kind === 'on-battery').map((w) => w.subject)).toEqual(['hq-ups-a', 'hq-ups-b']);
  });

  const r = run(off('hq-mains'), off('hq-ups-a'), off('hq-ups-b'));

  it('mains and batteries gone: clinics lose everything that lives at HQ', () => {
    expect(r.sites.hq.wan).toBe('offline');
    expect(r.sites.hh.vpn).toBe('down');
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('down');
    expect(cap(r, 'hh-tr1-mac', 'view-images')).toBe('down');
    expect(cap(r, 'hh-rec-mac1', 'files')).toBe('down');
    expect(cap(r, 'ber-lab1', 'send-results')).toBe('down');
  });

  it('clinics keep the cloud practice software, card payments, phones, internet and local devices', () => {
    expect(r.sites.hh.wan).toBe('primary');
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('up');
    expect(cap(r, 'hh-pos1', 'pay')).toBe('up');
    expect(cap(r, 'hh-phone1', 'calls')).toBe('up');
    expect(cap(r, 'hh-guest', 'guest-internet')).toBe('up');
    expect(cap(r, 'hh-rec-mac1', 'print-receipt')).toBe('up');
    expect(cap(r, 'hh-xray-pc', 'take-xray')).toBe('up');
  });
});

describe('clinic power', () => {
  it('mains off: the network stays up on the UPS, but the Macs, printers and card terminal are dark', () => {
    const r = run(off('hh-mains'));
    expect(r.devices['hh-fw'].on).toBe(true);
    expect(r.devices['hh-ups']).toMatchObject({ onBattery: true });
    expect(r.devices['hh-rec-mac1'].on).toBe(false);
    expect(cap(r, 'hh-pos1', 'pay')).toBe('down');
    // Laptops and phones run on: battery and PoE from the switch behind the UPS
    expect(cap(r, 'hh-tr1-mac', 'records')).toBe('up');
    expect(cap(r, 'hh-phone1', 'calls')).toBe('up');
  });
});

describe('other fault types', () => {
  it('degraded primary line: everything works, slowly, and no failover happens', () => {
    const r = run({ type: 'degrade', target: { kind: 'link', id: 'hh-wan1' } });
    expect(r.links['hh-wan1'].state).toBe('degraded');
    expect(r.sites.hh).toEqual({ wan: 'primary', vpn: 'primary', state: 'degraded' });
    expect(r.links['hh-wan2'].state).toBe('standby');
    expect(cap(r, 'hh-pos1', 'pay')).toBe('degraded');
    expect(cause(r, 'hh-pos1', 'pay')).toMatchObject({ fault: 0, reason: 'poor-link' });
  });

  it('expired certificate on the image archive: nobody can store or view images, the server is still on', () => {
    const r = run({ type: 'service-failure', variant: 'cert-expired', target: { kind: 'service', id: 'pacs' } });
    expect(r.devices['hq-pacs'].on).toBe(true);
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('down');
    expect(cap(r, 'ber-tr1-mac', 'view-images')).toBe('down');
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('up');
  });

  it('the cloud practice software is unreachable: every clinic notices, local work goes on', () => {
    const r = run(off('cloud-lb'));
    expect(cap(r, 'hh-rec-mac1', 'records')).toBe('down');
    expect(cap(r, 'ber-tr1-mac', 'records')).toBe('down');
    expect(cap(r, 'hh-pos1', 'pay')).toBe('up');
    expect(cap(r, 'hh-xray-pc', 'archive-images')).toBe('up');
  });
});

describe('engine properties', () => {
  it('is pure: the same faults give the same result, in any order', () => {
    const a = run(cut('hh-wan1'), off('hq-esx1'));
    const b = run(off('hq-esx1'), cut('hh-wan1'));
    expect(a.devices).toEqual(run(cut('hh-wan1'), off('hq-esx1')).devices);
    expect(a.sites).toEqual(b.sites);
    expect(a.capabilities.map((c) => c.state)).toEqual(b.capabilities.map((c) => c.state));
  });

  it('never makes anything better by adding a fault', () => {
    const rank = { up: 0, degraded: 1, down: 2 };
    const base = run(cut('hh-wan1'));
    const more = run(cut('hh-wan1'), off('hq-core1'), off('ber-sw2'));
    base.capabilities.forEach((c, i) => expect(rank[more.capabilities[i].state]).toBeGreaterThanOrEqual(rank[c.state]));
  });

  it('attributes every failed capability to a fault', () => {
    for (const faults of [[off('hh-sw1')], [cut('hh-wan1'), cut('hh-wan2')], [off('hq-mains'), off('hq-ups-a'), off('hq-ups-b')], [off('hq-esx1'), off('hq-esx2')]]) {
      const r = run(...faults);
      const unexplained = r.capabilities.filter((c) => c.state === 'down' && !(c.cause && c.cause.fault >= 0));
      expect(unexplained.map((c) => `${c.device}/${c.capability}`)).toEqual([]);
    }
  });
});

describe('HA placement', () => {
  const initial = new Map(TOPOLOGY.devices.filter((d) => d.runsOn).map((d) => [d.id, d.runsOn!]));

  it('leaves everything in place when all hosts run', () => {
    const p = placeVms(CLUSTER, initial, () => true);
    expect([...p.values()].every((v) => !v.restarted && v.host)).toBe(true);
  });

  it('keeps the two identity servers apart after a host failure', () => {
    const p = placeVms(CLUSTER, initial, (h) => h !== 'hq-esx1');
    expect(p.get('hq-dc1')!.host).not.toBe(p.get('hq-dc2')!.host);
    expect([...p.values()].every((v) => v.host)).toBe(true);
  });

  it('starts nothing without a host', () => {
    const p = placeVms(CLUSTER, initial, () => false);
    expect([...p.values()].every((v) => !v.host && v.reason === 'no-host')).toBe(true);
  });
});
