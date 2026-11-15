import { describe, expect, it } from 'vitest';
import rawIssues from '../data/issues.json';
import { CLUSTER, FAULTS, INDEX, ISSUES, ROLES, TOPOLOGY } from '../data';
import { FLAT } from '../i18n/dictionaries';
import { buildFault, explain } from '../engine/explain';
import { simulate } from '../engine/simulate';
import { highlightFor, validateIssues } from './issues';

describe('issues.json', () => {
  const v = validateIssues(rawIssues, INDEX, FAULTS);

  it('is valid and every text exists in every language', () => {
    expect(v.issues).toEqual([]);
    for (const lang of ['en', 'de', 'tr'] as const) expect(v.keys.filter((k) => !(k.key in FLAT[lang])).map((k) => k.key)).toEqual([]);
  });

  it('covers every topic the brief asks for', () => {
    const ids = ISSUES.issues.map((i) => i.id);
    for (const topic of ['label-printer', 'card-terminal', 'wifi-treatment', 'file-share', 'xray-archive', 'lab-results', 'vpn-down', 'internet-slow', 'voip-quality', 'locked-out', 'onboarding', 'offboarding', 'update-broke', 'disk-full', 'cert-expired', 'mdm-not-enrolled']) {
      expect(ids).toContain(topic);
    }
    expect(ids.length).toBeGreaterThanOrEqual(15);
    expect(ids.length).toBeLessThanOrEqual(20);
  });

  it('rejects an unknown role and a fault that does not fit', () => {
    const broken = structuredClone(rawIssues);
    broken.issues[0].show.roles = ['no-such-role'];
    broken.issues[2].simulate = [{ action: 'dns-stopped', target: 'hh-pos1' }];
    const messages = validateIssues(broken, INDEX, FAULTS).issues.map((i) => i.message);
    expect(messages).toContain('Role "no-such-role" is not defined');
    expect(messages.some((m) => m.includes('cannot be applied'))).toBe(true);
  });
});

describe('every issue', () => {
  for (const issue of ISSUES.issues) {
    it(`${issue.id}: highlights devices in its site${issue.simulate ? ' and its simulation has an effect' : ''}`, () => {
      const lit = [...highlightFor(issue, INDEX)];
      expect(lit.some((id) => INDEX.devices.get(id)!.site === issue.show.site)).toBe(true);
      if (!issue.simulate) return;
      const active = issue.simulate.map((f) => buildFault(FAULTS, INDEX, f.action, f.target)!);
      const result = simulate(
        TOPOLOGY,
        active.map((a) => a.fault),
        { roles: ROLES, cluster: CLUSTER },
      );
      expect(explain(FAULTS, INDEX, active, result).outcome).not.toBe('healthy');
      expect(result.affected.length).toBeGreaterThan(0);
    });
  }
});
