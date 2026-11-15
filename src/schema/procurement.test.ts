import { describe, expect, it } from 'vitest';
import { CATALOG, INDEX } from '../data';
import { computeBom, type BomInput } from './playbook';
import { cartFromBom, inventory, preflight, schedule, type Cart } from './procurement';

const D = CATALOG.defaults;
const input: BomInput = { rooms: D.rooms, desks: D.desks, areaM2: D.areaM2, features: { xray: D.xray, lab: D.lab } };
const kit = () => cartFromBom(computeBom(CATALOG, input));
const check = (cart: Cart, id: string, week = -8) => preflight(CATALOG, cart, input, week).find((c) => c.id === id)!;
const failing = (cart: Cart, week = -8) => preflight(CATALOG, cart, input, week).filter((c) => !c.ok).map((c) => c.id);

describe('the default kit for München', () => {
  it('matches the template: 3 access points from the floor area, 4 Macs, licences for every device', () => {
    const cart = kit();
    expect(cart.ap).toBe(3);
    expect(cart['mac-desk'] + cart['mac-room']).toBe(4);
    expect(cart['lic-net']).toBe(cart.fw + cart.switch + cart.ap);
    expect(cart['lic-mdm']).toBe(4);
    // Vendor-supplied medical devices are not bought
    expect(cart['xray-port']).toBeUndefined();
  });

  it('passes every check except the spares, which one click adds', () => {
    const cart = kit();
    expect(failing(cart)).toEqual(['spares']);
    const fixed = check(cart, 'spares').fix!;
    expect(fixed.ap).toBe(4);
    expect(fixed.terminal).toBe(3);
    expect(failing(fixed)).toEqual([]);
  });
});

describe('order checks', () => {
  it('a missing switch fails ports, PoE and the kit; the fix adds it back', () => {
    const cart = { ...kit(), switch: 0 };
    expect(failing(cart)).toEqual(expect.arrayContaining(['coverage', 'ports', 'poe']));
    expect(check(cart, 'ports').fix!.switch).toBe(1);
  });

  it('a consumer router stands in for the firewall but is flagged as not standard', () => {
    const cart = { ...kit(), fw: 0, 'consumer-router': 1 };
    expect(check(cart, 'coverage').ok).toBe(true);
    const standard = check(cart, 'standard');
    expect(standard.ok).toBe(false);
    expect(standard.params.items).toEqual(['consumer-router']);
    expect(standard.fix).toMatchObject({ fw: 1 });
    expect(standard.fix!['consumer-router']).toBeUndefined();
  });

  it('Macs from a retail shop fail the purchase channel check', () => {
    expect(check({ ...kit(), 'mac-room': 1, 'mac-retail': 1 }, 'mdm')).toMatchObject({ ok: false, params: { count: 1 } });
  });

  it('missing licences are found and fixed', () => {
    const c = check({ ...kit(), 'lic-mdm': 0 }, 'licences');
    expect(c.ok).toBe(false);
    expect(c.fix!['lic-mdm']).toBe(4);
  });

  it('a large cabinet load needs a second UPS', () => {
    const c = check({ ...kit(), ap: 30, switch: 3 }, 'ups');
    expect(c.ok).toBe(false);
    expect(c.fix!.ups).toBe(2);
  });
});

describe('lead times', () => {
  it('ordered in week T−8, everything is on site before the installation', () => {
    expect(schedule(CATALOG, kit(), -8).every((a) => a.lateDays === 0)).toBe(true);
  });

  it('ordered in week T−4, the card terminals are ready only 5 days after go-live', () => {
    const late = schedule(CATALOG, kit(), -4).filter((a) => a.lateDays > 0);
    expect(late.find((a) => a.sku === 'terminal')).toMatchObject({ readyDay: 5 });
    // The two 21-day items are the latest; at T−4 nearly everything misses the installation
    expect(late.slice(0, 2).map((a) => a.sku).sort()).toEqual(['cabinet', 'terminal']);
    expect(check(kit(), 'leadtime', -4).ok).toBe(false);
    // Terminals are in HQ stock, so there is a workaround
    expect(CATALOG.items.find((i) => i.sku === 'terminal')!.hqStock).toBeGreaterThan(0);
  });
});

describe('inventory', () => {
  const cart = check(kit(), 'spares').fix!;
  const rows = inventory(CATALOG, cart, INDEX, 'muc', input);

  it('maps units onto the devices of the new clinic, with their room, VLAN and address', () => {
    expect(rows.find((r) => r.sku === 'fw')).toMatchObject({ device: 'muc-fw', hostname: 'MUC-FW-01', ip: '10.3.10.1', vlan: 10, zone: 'muc-cabinet' });
    expect(rows.find((r) => r.device === 'muc-rec-mac1')).toMatchObject({ dhcp: true, vlan: 20 });
  });

  it('marks spares, gives every unit its own asset tag, and leaves licences out', () => {
    expect(rows.filter((r) => r.sku === 'ap' && r.spare)).toHaveLength(1);
    expect(new Set(rows.map((r) => r.asset)).size).toBe(rows.length);
    expect(rows.some((r) => r.sku.startsWith('lic-'))).toBe(false);
    expect(inventory(CATALOG, cart, INDEX, 'muc', input).map((r) => r.serial)).toEqual(rows.map((r) => r.serial));
  });
});
