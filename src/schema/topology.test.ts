import { describe, expect, it } from 'vitest';
import rawTopology from '../data/topology.json';
import rawRoles from '../data/roles.json';
import { FLAT } from '../i18n/dictionaries';
import { evaluateAccess } from '../utils/access';
import { inSubnet, subnetOf } from '../utils/ip';
import { layoutOverview, layoutSite, portalId } from '../utils/layout';
import { buildIndex } from '../utils/topologyIndex';
import { validateData } from './validateTopology';

const result = validateData(rawTopology, rawRoles);
const topo = result.topology!;
const index = buildIndex(topo, result.roles!);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const errorsOf = (t: unknown) => validateData(t, rawRoles).issues.filter((i) => i.severity === 'error');

describe('the real data files', () => {
  it('are valid', () => {
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('use only translation keys that exist', () => {
    expect(result.keys.filter((k) => !(k.key in FLAT.en))).toEqual([]);
  });
});

describe('template expansion', () => {
  it('builds every clinic from the same template, with the site number in the addresses', () => {
    expect(index.devices.get('hh-fw')).toMatchObject({ name: 'HH-FW-01', ip: '10.2.10.1', site: 'hh', zone: 'hh-cabinet' });
    expect(index.devices.get('muc-fw')).toMatchObject({ name: 'MUC-FW-01', ip: '10.3.10.1', site: 'muc' });
    expect(index.links.get('vpn-hh-2')).toMatchObject({ kind: 'vpn', role: 'backup', via: 'hh-wan2' });
  });

  it('gives the large variant a second switch and a fourth access point', () => {
    expect(index.devices.has('ber-sw2')).toBe(true);
    expect(index.devices.has('ber-ap4')).toBe(true);
    expect(index.devices.has('hh-sw2')).toBe(false);
    expect(index.devices.has('hh-ap4')).toBe(false);
    // The X-ray PC hangs on the second switch where there is one
    expect(index.links.get('ber-l-xray')?.a.device).toBe('ber-sw2');
    expect(index.links.get('hh-l-xray')?.a.device).toBe('hh-sw1');
  });

  it('drops feature devices when the site lacks the feature', () => {
    const t = clone(rawTopology);
    t.sites.find((s) => s.id === 'hh')!.features = ['lab'];
    const r = validateData(t, rawRoles);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const ids = new Set(r.topology!.devices.map((d) => d.id));
    expect(ids.has('hh-xray-pc')).toBe(false);
    expect(ids.has('hh-lab1')).toBe(true);
  });

  it('adds a clinic with one new entry in "sites"', () => {
    const t = clone(rawTopology) as typeof rawTopology & { sites: unknown[] };
    t.sites.push({ id: 'cgn', number: 4, code: 'CGN', kind: 'clinic', template: 'clinic', variant: 'medium', features: [], status: 'planned', map: { x: 14, y: 60 } });
    const r = validateData(t, rawRoles);
    // Only the three texts of the new site are missing; the structure is complete
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.topology!.devices.find((d) => d.id === 'cgn-fw')?.ip).toBe('10.4.10.1');
  });

  it('links every VM to the host it starts on', () => {
    expect(index.links.get('virt-hq-dc1')).toMatchObject({ kind: 'virtual', b: { device: 'hq-esx1' } });
    // Anti-affinity: the two identity servers start on different hosts
    expect(index.devices.get('hq-dc1')!.runsOn).not.toBe(index.devices.get('hq-dc2')!.runsOn);
  });
});

describe('validation catches broken data', () => {
  it('an address outside its subnet', () => {
    const t = clone(rawTopology);
    t.devices.find((d) => d.id === 'hq-fw1')!.ip = '10.1.10.2';
    expect(errorsOf(t).map((e) => e.message)).toContain('10.1.10.2 is outside 10.0.10.0/24');
  });

  it('a duplicate address', () => {
    const t = clone(rawTopology);
    t.devices.find((d) => d.id === 'hq-fw2')!.ip = '10.0.10.2';
    expect(errorsOf(t).some((e) => e.message.includes('is also used by'))).toBe(true);
  });

  it('a link to a device that does not exist', () => {
    const t = clone(rawTopology);
    t.links[0].b.device = 'nope';
    expect(errorsOf(t).some((e) => e.message === 'Device "nope" does not exist')).toBe(true);
  });

  it('a VPN tunnel without a WAN link', () => {
    const t = clone(rawTopology);
    t.templates.clinic.links.find((l) => l.id === 'vpn-{site}-1')!.via = '{site}-fw-sw1';
    expect(errorsOf(t).some((e) => e.message.includes('is not a WAN link'))).toBe(true);
  });

  it('an unknown field (typo)', () => {
    const t = clone(rawTopology) as { devices: Array<Record<string, unknown>> };
    t.devices[0].modle = 'x';
    expect(errorsOf(t).length).toBeGreaterThan(0);
  });
});

describe('addressing plan', () => {
  it('is 10.<site>.<vlan>.0/24', () => {
    expect(subnetOf(2, 40)).toBe('10.2.40.0/24');
    expect(inSubnet('10.2.40.17', 2, 40)).toBe(true);
    expect(inSubnet('10.2.41.17', 2, 40)).toBe(false);
    expect(inSubnet('10.2.40.255', 2, 40)).toBe(false);
  });
});

describe('access policy', () => {
  const access = (from: number, to: number | 'internet' | 'hq-servers') => evaluateAccess(topo.accessPolicy, from, to).status;

  it('isolates card terminals: payment provider only', () => {
    expect(access(40, 'internet')).toBe('limited');
    expect(access(40, 20)).toBe('denied');
    expect(access(40, 'hq-servers')).toBe('denied');
  });

  it('keeps medical devices off the internet but lets them reach HQ', () => {
    expect(access(30, 'internet')).toBe('denied');
    expect(access(30, 'hq-servers')).toBe('limited');
    expect(access(30, 20)).toBe('denied');
  });

  it('gives guests internet and nothing else', () => {
    expect(access(100, 'internet')).toBe('allowed');
    expect(access(100, 20)).toBe('denied');
    expect(access(100, 'hq-servers')).toBe('denied');
  });

  it('lets staff print, use the internet and reach HQ services', () => {
    expect(access(20, 'internet')).toBe('allowed');
    expect(access(20, 50)).toBe('limited');
    expect(access(20, 'hq-servers')).toBe('limited');
    expect(access(20, 30)).toBe('denied');
    expect(access(20, 20)).toBe('same');
  });
});

describe('index', () => {
  it('finds the local provider for per-site services and the HQ provider for global ones', () => {
    expect(index.providersOf('dhcp', 'hh').map((d) => d.id)).toEqual(['hh-fw']);
    expect(index.providersOf('dns-internal', 'hh').map((d) => d.id)).toEqual(['hq-dc1', 'hq-dc2']);
  });

  it('knows what depends on a clinic switch and on the PACS', () => {
    const onSwitch = index.dependentsOf('hh-sw1').map((d) => d.id);
    expect(onSwitch).toEqual(expect.arrayContaining(['hh-rec-mac1', 'hh-pos1', 'hh-ap1', 'hh-phone1', 'hh-xray-pc']));
    const onPacs = index.dependentsOf('hq-pacs').map((d) => d.id);
    expect(onPacs).toEqual(expect.arrayContaining(['hh-xray-pc', 'ber-xray-pc', 'ber-us']));
    expect(onPacs).not.toContain('hh-pos1');
  });
});

describe('layout', () => {
  it('shows every site on the overview and connects clinics to HQ and to the internet', () => {
    const { nodes, edges } = layoutOverview(index);
    expect(nodes.filter((n) => n.type === 'site')).toHaveLength(topo.sites.length);
    expect(edges.filter((e) => e.id.startsWith('vpn-hh-')).map((e) => [e.source, e.target])).toEqual([
      ['site:hh', 'site:hq'],
      ['site:hh', 'site:hq'],
    ]);
  });

  it('places every device of a site without overlaps and adds portals to neighbouring sites', () => {
    for (const site of topo.sites) {
      const { nodes } = layoutSite(index, site.id);
      const devices = nodes.filter((n) => n.type === 'device');
      expect(devices).toHaveLength(index.devicesOfSite(site.id).length);
      const seen = new Set(devices.map((n) => `${n.position.x},${n.position.y}`));
      expect(seen.size).toBe(devices.length);
    }
    const ids = layoutSite(index, 'hh').nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([portalId('hq'), portalId('ext')]));
  });
});
