import { describe, expect, it } from 'vitest';
import rawPrivacy from '../data/privacy.json';
import rawMonitoring from '../data/monitoring.json';
import { CLUSTER, FAULTS, INDEX, MONITORING, PRIVACY, ROLES, TOPOLOGY } from '../data';
import { FLAT } from '../i18n/dictionaries';
import { simulate } from '../engine/simulate';
import { buildFault, type ActiveFault } from '../engine/explain';
import { privacyByDevice, statusBoard, validateCompliance } from './compliance';

const LIVE = ['hq', 'ber', 'hh'];
const board = (...faults: Array<[string, string]>) => {
  const active = faults.map(([a, t]) => buildFault(FAULTS, INDEX, a, t)!) as ActiveFault[];
  const result = simulate(
    TOPOLOGY,
    active.map((a) => a.fault),
    { roles: ROLES, cluster: CLUSTER },
  );
  return statusBoard(result, INDEX, MONITORING, LIVE, active);
};

describe('privacy.json and monitoring.json', () => {
  it('are valid and every text exists in every language', () => {
    const v = validateCompliance(rawPrivacy, rawMonitoring, INDEX, FAULTS);
    expect(v.issues).toEqual([]);
    for (const lang of ['en', 'de', 'tr'] as const) expect(v.keys.filter((k) => !(k.key in FLAT[lang])).map((k) => k.key)).toEqual([]);
  });

  it('cover every measure group the brief lists', () => {
    const per = (loc: string) => PRIVACY.measures.filter((m) => m.location === loc).length;
    expect([per('clinic'), per('transit'), per('hq'), per('cloud'), per('organization')]).toEqual([7, 3, 6, 5, 5]);
  });
});

describe('data protection layer', () => {
  const map = privacyByDevice(PRIVACY, INDEX);

  it('puts the measures on the devices that hold personal data', () => {
    expect(map.get('hh-rec-mac1')!.map((m) => m.id)).toEqual(['screen-lock', 'encryption', 'no-local']);
    expect(map.get('hh-pos1')!.flatMap((m) => m.categories)).toContain('payment');
    expect(map.get('cloud-pms')!.map((m) => m.id)).toEqual(expect.arrayContaining(['iam', 'eu', 'dpa']));
  });

  it('leaves out devices without personal data', () => {
    expect(map.has('hh-ups')).toBe(false);
    expect(map.has('hq-mains')).toBe(false);
  });
});

describe('status board', () => {
  it('healthy network: only the certificate that expires in 14 days', () => {
    const b = board();
    expect(b.alerts).toEqual([{ health: 'warn', key: 'mon.alert.certSoon', params: { service: 'files', days: 14 } }]);
    expect(b.sites.every((s) => s.health === 'ok')).toBe(true);
    expect(b.hq).toMatchObject({ hosts: { up: 3, health: 'ok' }, vms: { running: 10, health: 'ok' }, backup: 'ok' });
  });

  it('reflects the simulator: primary line cut in Hamburg', () => {
    const hh = board(['cut-link', 'hh-wan1']).sites.find((s) => s.site === 'hh')!;
    expect(hh).toMatchObject({ wan: { value: 'backup', health: 'warn' }, vpn: { value: 'backup', health: 'warn' } });
  });

  it('reflects the simulator: switch off, host off, certificate expired', () => {
    const b = board(['power-off', 'hh-sw1'], ['power-off', 'hq-esx1'], ['cert-expired', 'hq-pacs']);
    const hh = b.sites.find((s) => s.site === 'hh')!;
    expect(hh.wifi).toMatchObject({ up: 0, health: 'bad' });
    expect(hh.key.down).toContain('hh-sw1');
    expect(b.hq.hosts).toMatchObject({ up: 2, health: 'warn' });
    expect(b.hq.vms).toMatchObject({ restarted: 3, health: 'warn' });
    expect(b.hq.certs.find((c) => c.service === 'pacs')).toMatchObject({ expired: true, health: 'bad' });
    expect(b.alerts[0].health).toBe('bad');
  });

  it('every alert it can raise has a text in every language', () => {
    const scenarios: Array<Array<[string, string]>> = [
      [['cut-link', 'hh-wan1']],
      [['cut-link', 'hh-wan1'], ['cut-link', 'hh-wan2']],
      [['tunnels-down', 'hh-fw']],
      [['power-off', 'hh-ap2']],
      [['power-off', 'hh-sw1']],
      [['power-off', 'hq-esx1']],
      [['power-off', 'hq-esx1'], ['power-off', 'hq-esx2']],
      [['power-off', 'hq-ctl-a']],
      [['power-off', 'hq-backup']],
      [['cert-expired', 'hq-pacs']],
    ];
    const keys = new Set(scenarios.flatMap((f) => board(...f).alerts.map((a) => a.key)));
    expect(keys.size).toBeGreaterThan(8);
    for (const lang of ['en', 'de', 'tr'] as const) expect([...keys].filter((k) => !(k in FLAT[lang]))).toEqual([]);
  });
});
