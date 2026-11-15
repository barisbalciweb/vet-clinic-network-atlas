import { describe, expect, it } from 'vitest';
import { CLUSTER, TOPOLOGY } from '../data';
import {
  admission,
  drsRecommend,
  failureImpact,
  hostHealth,
  imbalance,
  initialRuntime,
  loadPct,
  reconcile,
  ruleStatus,
  scaleCluster,
  type IsolationResponse,
  type LabInput,
  type Runtime,
} from './haLab';

const lab = (o: { off?: string[]; cut?: string[]; maintenance?: string[]; isolated?: string[] } = {}): LabInput => ({
  deviceOn: (id) => !(o.off ?? []).includes(id),
  cutLinks: new Set(o.cut ?? []),
  maintenance: new Set(o.maintenance ?? []),
  isolated: new Set(o.isolated ?? []),
});
const health = (o: Parameters<typeof lab>[0] = {}) => hostHealth(TOPOLOGY, CLUSTER, lab(o));
const start = initialRuntime(TOPOLOGY, CLUSTER);
const step = (o: Parameters<typeof lab>[0], runtime: Runtime = start, response: IsolationResponse = 'keep-running', vcenter = true) =>
  reconcile(CLUSTER, runtime, health(o), response, vcenter);
const vmsOn = (r: Runtime, host: string) => Object.keys(r).filter((vm) => r[vm].host === host).sort();

describe('host health', () => {
  it('healthy cluster: two uplinks and four storage paths per host', () => {
    for (const h of Object.values(health())) {
      expect(h).toMatchObject({ status: 'ok', storagePaths: 4, storagePathsTotal: 4 });
      expect(h.uplinks.map((u) => u.up)).toEqual([true, true]);
    }
  });

  it('one uplink cut: still ok, half the storage paths', () => {
    const h = health({ cut: ['hq-esx1-core1'] })['hq-esx1'];
    expect(h.status).toBe('ok');
    expect(h.storagePaths).toBe(2);
  });

  it('one core switch off: every host keeps one uplink and two paths', () => {
    expect(Object.values(health({ off: ['hq-core1'] })).map((h) => [h.status, h.storagePaths])).toEqual([
      ['ok', 2],
      ['ok', 2],
      ['ok', 2],
    ]);
  });

  it('one controller off: two paths left, both controllers off: no storage', () => {
    expect(health({ off: ['hq-ctl-a'] })['hq-esx2'].storagePaths).toBe(2);
    expect(health({ off: ['hq-ctl-a', 'hq-ctl-b'] })['hq-esx2'].status).toBe('no-storage');
  });

  it('both uplinks gone: no network', () => {
    expect(health({ cut: ['hq-esx3-core1', 'hq-esx3-core2'] })['hq-esx3'].status).toBe('no-network');
  });
});

describe('HA restart', () => {
  it('starts balanced, with N+1 kept and no DRS recommendation', () => {
    expect(vmsOn(start, 'hq-esx1')).toEqual(['hq-dc1', 'hq-jump', 'hq-pacs']);
    expect(admission(CLUSTER).ok).toBe(true);
    expect(drsRecommend(CLUSTER, start, health())).toEqual([]);
  });

  it('host failure: its VMs restart elsewhere, identity first, anti-affinity kept', () => {
    const { runtime, transitions } = step({ off: ['hq-esx1'] });
    expect(transitions.map((t) => [t.vm, t.kind])).toEqual([
      ['hq-dc1', 'restart'],
      ['hq-pacs', 'restart'],
      ['hq-jump', 'restart'],
    ]);
    expect(vmsOn(runtime, 'hq-esx1')).toEqual([]);
    expect(runtime['hq-dc1'].host).not.toBe(runtime['hq-dc2'].host);
    expect(runtime['hq-pacs'].restarted).toBe(true);
    expect(ruleStatus(CLUSTER, runtime)[0].state).toBe('ok');
  });

  it('a host without storage counts as failed', () => {
    const { transitions } = step({ cut: ['hq-esx2-core1', 'hq-esx2-core2'] });
    expect(transitions.every((t) => t.kind === 'restart' && t.from === 'hq-esx2')).toBe(true);
  });

  it('two hosts: what does not fit stays off; anti-affinity gives way', () => {
    const { runtime, transitions } = step({ off: ['hq-esx1', 'hq-esx2'] });
    expect(transitions.find((t) => t.vm === 'hq-files')?.kind).toBe('no-capacity');
    expect(runtime['hq-files'].host).toBeNull();
    expect(ruleStatus(CLUSTER, runtime)[0].state).toBe('violated');
  });

  it('a host that comes back stays empty, and HA retries what was off', () => {
    const down = step({ off: ['hq-esx1', 'hq-esx2'] }).runtime;
    const back = step({ off: ['hq-esx1'] }, down);
    expect(back.transitions.find((t) => t.vm === 'hq-files')).toMatchObject({ kind: 'restart', to: 'hq-esx2' });
    const restored = step({}, back.runtime);
    expect(restored.transitions).toEqual([]);
    expect(vmsOn(restored.runtime, 'hq-esx1')).toEqual([]);
  });
});

describe('maintenance mode and isolation', () => {
  it('maintenance: VMs move with vMotion, no restart', () => {
    const { runtime, transitions } = step({ maintenance: ['hq-esx2'] });
    expect(transitions.length).toBe(4);
    expect(transitions.every((t) => t.kind === 'migrate')).toBe(true);
    expect(vmsOn(runtime, 'hq-esx2')).toEqual([]);
    expect(runtime['hq-files'].restarted).toBeUndefined();
  });

  it('maintenance without vCenter: nothing can move', () => {
    const { runtime, transitions } = step({ maintenance: ['hq-esx2'] }, start, 'keep-running', false);
    expect(transitions).toEqual([]);
    expect(vmsOn(runtime, 'hq-esx2')).toEqual(vmsOn(start, 'hq-esx2'));
  });

  it('isolation: VMs keep running, or restart elsewhere if so configured', () => {
    expect(step({ isolated: ['hq-esx3'] }).transitions).toEqual([]);
    const off = step({ isolated: ['hq-esx3'] }, start, 'power-off');
    expect(off.transitions.map((t) => t.kind)).toEqual(['restart', 'restart', 'restart']);
  });
});

describe('DRS', () => {
  it('recommends moves onto a host that came back, until the spread is below the threshold', () => {
    const down = step({ off: ['hq-esx1'] }).runtime;
    const back = step({}, down).runtime;
    const moves = drsRecommend(CLUSTER, back, health());
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.to === 'hq-esx1')).toBe(true);
    const after = { ...back };
    for (const m of moves) after[m.vm] = { host: m.to };
    expect(imbalance(CLUSTER, after, ['hq-esx1', 'hq-esx2', 'hq-esx3'])).toBeLessThanOrEqual(CLUSTER.drs.thresholdPct);
    expect(ruleStatus(CLUSTER, after)[0].state).toBe('ok');
  });
});

describe('admission control', () => {
  it('N+1 on three equal hosts leaves two thirds usable', () => {
    const a = admission(CLUSTER);
    expect(a.limitPct).toBeCloseTo(66.7, 1);
    expect(a.usedPct).toBeCloseTo(52.1, 1);
  });

  it('scales the load and reports which VMs would be lost per host failure', () => {
    expect(loadPct(scaleCluster(CLUSTER, 80))).toBeCloseTo(80, 0);
    const ok = failureImpact(CLUSTER, start, health());
    expect(ok.every((r) => r.lost.length === 0)).toBe(true);
    const heavy = scaleCluster(CLUSTER, 85);
    expect(admission(heavy).ok).toBe(false);
    expect(failureImpact(heavy, start, health()).some((r) => r.lost.length > 0)).toBe(true);
  });
});
