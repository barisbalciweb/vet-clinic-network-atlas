import { describe, expect, it } from 'vitest';
import rawFaults from '../data/faults.json';
import { CLUSTER, FAULTS, INDEX, ROLES, TOPOLOGY } from '../data';
import { FLAT } from '../i18n/dictionaries';
import { simulate } from './simulate';
import { LAYERS, actionsFor, buildFault, explain, guideFor, validateFaultData, type ActiveFault, type Outcome } from './explain';

const run = (active: ActiveFault[]) => {
  const result = simulate(
    TOPOLOGY,
    active.map((a) => a.fault),
    { roles: ROLES, cluster: CLUSTER },
  );
  return { result, ex: explain(FAULTS, INDEX, active, result) };
};
const scenario = (id: string) => FAULTS.scenarios.find((s) => s.id === id)!.faults.map((f) => buildFault(FAULTS, INDEX, f.action, f.target)!);
const fault = (action: string, target: string) => buildFault(FAULTS, INDEX, action, target)!;

describe('faults.json', () => {
  const v = validateFaultData(rawFaults, INDEX, ROLES);

  it('is valid and has a guide for every action on every device and link', () => {
    expect(v.issues).toEqual([]);
  });

  it('uses only translation keys that exist', () => {
    expect(v.keys.filter((k) => !(k.key in FLAT.en)).map((k) => k.key)).toEqual([]);
  });

  it('rejects a scenario with an action that does not fit its target', () => {
    const broken = structuredClone(rawFaults);
    broken.scenarios[0].faults[0] = { action: 'cut-link', target: 'hh-sw1' };
    expect(validateFaultData(broken, INDEX, ROLES).issues.some((i) => i.message.includes('cannot be applied'))).toBe(true);
  });
});

describe('actions', () => {
  it('offers the right actions per device role and link kind', () => {
    const ids = (target: string) => actionsFor(FAULTS, INDEX, target).map((a) => a.id);
    expect(ids('hh-fw')).toEqual(expect.arrayContaining(['power-off', 'slow-device', 'tunnels-down', 'dhcp-staff-full', 'dhcp-guest-full']));
    expect(ids('hh-pos1')).toEqual(['power-off']);
    expect(ids('hq-dc1')).toEqual(expect.arrayContaining(['power-off', 'dns-stopped']));
    expect(ids('hh-wan1')).toEqual(['cut-link', 'slow-link']);
    expect(ids('vpn-hh-1')).toEqual(['tunnel-cut']);
    expect(ids('virt-hq-dc1')).toEqual([]);
  });

  it('builds the engine fault the action describes', () => {
    expect(fault('dhcp-guest-full', 'ber-fw').fault).toEqual({ type: 'service-failure', variant: 'dhcp-exhausted', target: { kind: 'service', id: 'dhcp', site: 'ber', vlan: 100 } });
    expect(fault('dns-stopped', 'hq-dc2').fault).toMatchObject({ target: { kind: 'device', id: 'hq-dc2' }, service: 'dns-internal' });
    expect(fault('cert-expired', 'hq-pacs').fault.target).toEqual({ kind: 'service', id: 'pacs' });
    expect(fault('cert-expired', 'cloud-lb').fault.target).toEqual({ kind: 'service', id: 'pms' });
    expect(buildFault(FAULTS, INDEX, 'dns-stopped', 'hh-pos1')).toBeUndefined();
  });

  it('picks the most specific guide', () => {
    expect(guideFor(FAULTS, INDEX, { action: 'power-off', target: 'hh-sw1' })?.id).toBe('switch-off');
    expect(guideFor(FAULTS, INDEX, { action: 'power-off', target: 'hq-pacs' })?.id).toBe('vm-off');
    expect(guideFor(FAULTS, INDEX, { action: 'power-off', target: 'cloud-mdm' })?.id).toBe('external-out');
    expect(guideFor(FAULTS, INDEX, { action: 'cut-link', target: 'hh-wan1' })?.id).toBe('wan-cut');
    expect(guideFor(FAULTS, INDEX, { action: 'cut-link', target: 'hh-l-rec1' })?.id).toBe('lan-cut');
  });
});

describe('every ready-made scenario', () => {
  const expected: Record<string, Outcome> = {
    'monday-switch': 'outage',
    digger: 'degraded',
    offline: 'outage',
    tunnel: 'outage',
    'guest-pool': 'outage',
    'access-point': 'outage',
    'card-terminal': 'outage',
    'dns-both': 'outage',
    host: 'degraded',
    'hq-isp': 'degraded',
    'hq-blackout': 'outage',
  };

  it('is covered by this test', () => {
    expect(FAULTS.scenarios.map((s) => s.id).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const [id, outcome] of Object.entries(expected)) {
    it(`${id}: ${outcome}, with a full explanation`, () => {
      const active = scenario(id);
      const { ex } = run(active);
      expect(ex.outcome).toBe(outcome);
      // Starts with what was broken, one line per fault
      expect(ex.chain.slice(0, active.length).map((c) => c.key)).toEqual(active.map((a) => `faults.action.${a.action}.done`));
      expect(ex.chain.every((c) => c.key in FLAT.en)).toBe(true);
      expect(ex.remedies).toHaveLength(active.length);
      expect(ex.tests.length).toBeGreaterThan(0);
      // Bottom-up: power before link before IP ... before service
      const order = ex.tests.map((s) => LAYERS.indexOf(s.layer));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });
  }
});

describe('explanation details', () => {
  it('Hamburg offline: tells what still works locally', () => {
    const { ex } = run(scenario('offline'));
    const works = ex.stillWorks.find((w) => w.site === 'hh')!.capabilities;
    expect(works).toEqual(expect.arrayContaining(['print-receipt', 'take-xray', 'run-analysis', 'scan']));
    expect(works).not.toContain('pay');
    expect(ex.chain.map((c) => c.key)).toEqual(expect.arrayContaining(['faults.event.siteOffline', 'faults.event.vpnDown']));
  });

  it('switch off: merges the devices that lose power into one line', () => {
    const { ex } = run(scenario('monday-switch'));
    const power = ex.chain.find((c) => c.key === 'faults.event.powerLost')!;
    expect(power.params).toMatchObject({ source: 'hh-sw1', count: 4 });
    expect([...(power.params.devices as string[])].sort()).toEqual(['hh-ap1', 'hh-ap2', 'hh-ap3', 'hh-phone1']);
    // The switch's own address is filled into the ping command
    expect(ex.tests.find((s) => s.id === 'ping-device')?.command).toBe('ping -c 3 10.2.10.2');
  });

  it('one core switch off: absorbed, with a redundancy warning', () => {
    const { ex } = run([fault('power-off', 'hq-core1')]);
    expect(ex.outcome).toBe('absorbed');
    expect(ex.affected).toEqual([]);
    expect(ex.warnings).toEqual([{ key: 'faults.warning.redundancyLost', params: { devices: ['hq-core1'] } }]);
  });

  it('ESXi host off: one line for all restarted virtual servers', () => {
    const { ex } = run(scenario('host'));
    const restart = ex.chain.find((c) => c.key === 'faults.event.vmRestarted')!;
    expect(restart.params.count).toBe(3);
    expect(ex.warnings.map((w) => w.key)).toContain('faults.warning.capacityReserveUsed');
  });

  it('two faults: tests are merged without duplicates and keep the bottom-up order', () => {
    const { ex } = run([fault('cut-link', 'hh-wan1'), fault('power-off', 'hh-sw1')]);
    const ids = ex.tests.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ex.tests[0].layer).toBe('power');
  });

  it('nothing broken: healthy, empty', () => {
    const { ex } = run([]);
    expect(ex).toMatchObject({ outcome: 'healthy', chain: [], affected: [], tests: [], remedies: [], warnings: [] });
  });
});
