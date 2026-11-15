import { describe, expect, it } from 'vitest';
import rawStandards from '../data/standards.json';
import { INDEX, PLAYBOOK, STANDARDS, TOPOLOGY } from '../data';
import { FLAT } from '../i18n/dictionaries';
import { ansibleOutput, ansibleRun, diffLines, siteConfig, validateStandards } from './standards';

describe('standards.json', () => {
  it('is valid and every text exists in every language', () => {
    const v = validateStandards(rawStandards, INDEX);
    expect(v.issues).toEqual([]);
    for (const lang of ['en', 'de', 'tr'] as const) expect(v.keys.filter((k) => !(k.key in FLAT[lang])).map((k) => k.key)).toEqual([]);
  });

  it('puts every clinic into a rollout stage, the pilot first and alone', () => {
    expect(STANDARDS.rollout[0].sites).toHaveLength(1);
    expect(STANDARDS.rollout.flatMap((r) => r.sites).sort()).toEqual(['ber', 'hh', 'muc']);
  });
});

describe('site configuration from the template', () => {
  const hh = siteConfig(TOPOLOGY, 'hh', STANDARDS, PLAYBOOK.dhcpPool);
  const muc = siteConfig(TOPOLOGY, 'muc', STANDARDS, PLAYBOOK.dhcpPool);

  it('has the same shape for every clinic', () => {
    expect(muc).toHaveLength(hh.length);
  });

  it('differs only in lines that carry the site variables', () => {
    const diff = diffLines(hh, muc);
    expect(diff.size).toBeGreaterThan(0);
    for (const i of diff) {
      expect(hh[i]).toMatch(/hh|HH|10\.2\./);
      expect(muc[i]).toMatch(/muc|MUC|10\.3\./);
    }
    // Everything that is not site-specific is identical: HQ peers, monitoring, policy
    expect(hh.filter((_, i) => !diff.has(i))).toEqual(expect.arrayContaining([expect.stringContaining('snmp v3 host 10.0.70.30'), expect.stringContaining('policy clinic-default')]));
  });

  it('renders the addressing plan', () => {
    expect(muc).toContain('vlan 20 name STAFF  gateway 10.3.20.1/24');
    expect(muc).toContain('  dhcp 10.3.20.100-199  dns 10.3.20.1');
    expect(muc.some((l) => l.startsWith('vlan 30') && l.includes('10.3.30.1'))).toBe(true);
    expect(muc.some((l) => l.startsWith('  dhcp 10.3.30.'))).toBe(false);
  });
});

describe('Ansible run', () => {
  const name = (id: string) => INDEX.devices.get(id)!.name;

  it('covers the switches of live clinics only, one host fails as in the data', () => {
    const hosts = ansibleRun(STANDARDS, INDEX, (s) => s !== 'muc', () => true);
    expect(hosts.map((h) => h.device)).toEqual(['ber-sw1', 'ber-sw2', 'hh-sw1']);
    expect(hosts.find((h) => h.device === 'hh-sw1')!.outcome).toBe('failed');
    const all = ansibleRun(STANDARDS, INDEX, () => true, () => true);
    expect(all.map((h) => h.device)).toContain('muc-sw1');
  });

  it('a switch that is off in the simulator is unreachable', () => {
    const hosts = ansibleRun(STANDARDS, INDEX, () => true, (d) => d !== 'ber-sw2');
    expect(hosts.find((h) => h.device === 'ber-sw2')).toMatchObject({ outcome: 'unreachable', ok: 0 });
  });

  it('prints a recap line per host in the usual format', () => {
    const hosts = ansibleRun(STANDARDS, INDEX, () => true, () => true);
    const out = ansibleOutput(hosts, name);
    expect(out.some((l) => l.startsWith('PLAY RECAP'))).toBe(true);
    expect(out).toContain('fatal: [HH-SW-01]: FAILED! => {"msg": "Authentication failed"}');
    expect(out.find((l) => l.startsWith('BER-SW-01'))).toMatch(/ok=3 {2}changed=2 {2}unreachable=0 {2}failed=0/);
  });
});
