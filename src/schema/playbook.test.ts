import { describe, expect, it } from 'vitest';
import rawPlaybook from '../data/playbook.json';
import rawCatalog from '../data/catalog.json';
import { CATALOG, CLUSTER, INDEX, PLAYBOOK, ROLES, TOPOLOGY, TOPOLOGY_OPENED } from '../data';
import { FLAT } from '../i18n/dictionaries';
import { simulate } from '../engine/simulate';
import { checkKey, computeBom, ipPlan, isLive, portPlan, validatePlaybook } from './playbook';

const qty = (bom: ReturnType<typeof computeBom>, sku: string) => bom.lines.find((l) => l.item.sku === sku)?.qty ?? 0;

describe('playbook.json and catalog.json', () => {
  const v = validatePlaybook(rawPlaybook, rawCatalog, INDEX);

  it('are valid and every text exists in every language', () => {
    expect(v.issues).toEqual([]);
    for (const lang of ['en', 'de', 'tr'] as const) expect(v.keys.filter((k) => !(k.key in FLAT[lang])).map((k) => k.key)).toEqual([]);
  });

  it('have the phases of the brief in order, ending one week after go-live', () => {
    expect(PLAYBOOK.phases.map((p) => p.id)).toEqual(['survey', 'isp', 'hardware', 'staging', 'install', 'validation', 'golive', 'hypercare']);
    expect(PLAYBOOK.phases.find((p) => p.id === 'golive')!.startWeek).toBe(0);
  });

  it('validation covers every go-live check the brief lists', () => {
    expect(PLAYBOOK.phases.find((p) => p.id === 'validation')!.checklist).toEqual(['workstations', 'payment', 'print', 'xray', 'lab', 'failover', 'guest', 'backup']);
  });
});

describe('bill of materials', () => {
  it('matches the example of the brief: 4 rooms → 3 access points, 6 Macs, 2 card terminals, 1 switch', () => {
    const bom = computeBom(CATALOG, { rooms: 4, desks: 1, features: { xray: true, lab: true } });
    expect(qty(bom, 'fw')).toBe(1);
    expect(qty(bom, 'ap')).toBe(3);
    expect(qty(bom, 'mac-desk') + qty(bom, 'mac-room')).toBe(6);
    expect(qty(bom, 'terminal')).toBe(2);
    expect(qty(bom, 'label')).toBe(1);
    expect(qty(bom, 'switch')).toBe(1);
    expect(bom.ports).toBe(16);
    expect(bom.poeW).toBeLessThanOrEqual(bom.poeBudgetW);
  });

  it('adds a second switch when the ports run out, and drops devices for missing features', () => {
    const big = computeBom(CATALOG, { rooms: 8, desks: 2, features: { xray: true, lab: true } });
    expect(qty(big, 'switch')).toBe(2);
    expect(qty(big, 'ap')).toBe(5);
    const small = computeBom(CATALOG, { rooms: 2, desks: 1, features: { xray: false, lab: false } });
    expect(qty(small, 'xray-port')).toBe(0);
    expect(small.lines.some((l) => l.item.sku === 'xray-port')).toBe(false);
  });
});

describe('plans for München', () => {
  it('IP plan: every clinic VLAN in 10.3.x.0/24, pools only where DHCP runs', () => {
    const plan = ipPlan(TOPOLOGY, 'muc', PLAYBOOK.dhcpPool);
    expect(plan.vlans.map((v) => v.vlan)).toEqual([10, 20, 30, 40, 50, 60, 100]);
    expect(plan.vlans.find((v) => v.vlan === 20)).toEqual({ vlan: 20, name: 'STAFF', subnet: '10.3.20.0/24', gateway: '10.3.20.1', dhcp: '10.3.20.100 – 10.3.20.199' });
    expect(plan.vlans.find((v) => v.vlan === 30)!.dhcp).toBeNull();
    expect(plan.statics[0]).toEqual({ device: 'muc-fw', ip: '10.3.10.1', vlan: 10 });
  });

  it('port plan: from the template, trunk to the firewall, PoE where devices draw power', () => {
    const rows = portPlan(INDEX, 'muc');
    expect(rows.find((r) => r.port === '24')).toMatchObject({ device: 'muc-fw', trunk: true });
    expect(rows.find((r) => r.device === 'muc-pos1')).toMatchObject({ port: '3', vlans: [40], poe: false });
    expect(rows.find((r) => r.device === 'muc-phone1')).toMatchObject({ vlans: [60], poe: true });
    expect(rows.map((r) => Number(r.port))).toEqual([...rows.map((r) => Number(r.port))].sort((a, b) => a - b));
  });
});

describe('going live', () => {
  const all = (upTo: string) => {
    const done = new Set<string>();
    for (const p of PLAYBOOK.phases) {
      for (const c of p.checklist) done.add(checkKey(p.id, c));
      if (p.id === upTo) break;
    }
    return done;
  };

  it('needs every step up to go-live, but not the hypercare week', () => {
    expect(isLive(PLAYBOOK, new Set())).toBe(false);
    expect(isLive(PLAYBOOK, all('validation'))).toBe(false);
    expect(isLive(PLAYBOOK, all('golive'))).toBe(true);
    const missingOne = all('golive');
    missingOne.delete(checkKey('survey', 'walk'));
    expect(isLive(PLAYBOOK, missingOne)).toBe(false);
  });

  it('a live München is part of the simulation, built like the other clinics', () => {
    const ctx = { roles: ROLES, cluster: CLUSTER };
    const before = simulate(TOPOLOGY, [], ctx);
    const after = simulate(TOPOLOGY_OPENED, [], ctx);
    expect(before.sites.muc).toBeUndefined();
    expect(after.healthy).toBe(true);
    expect(after.sites.muc).toEqual({ wan: 'primary', vpn: 'primary', state: 'up' });
    const broken = simulate(TOPOLOGY_OPENED, [{ type: 'power-off', target: { kind: 'device', id: 'muc-sw1' } }], ctx);
    expect(broken.affected.some((a) => a.site === 'muc' && a.state === 'down')).toBe(true);
  });
});
