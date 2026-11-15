import { describe, expect, it } from 'vitest';
import { INDEX } from '../../data';
import { linkStateOf } from './linkState';

const none = { down: new Set<string>(), degraded: new Set<string>() };
const link = (id: string) => INDEX.links.get(id)!;

describe('link state without simulation', () => {
  it('primary paths are up, backup paths stand by', () => {
    expect(linkStateOf(INDEX, link('hh-wan1'), none)).toBe('up');
    expect(linkStateOf(INDEX, link('hh-wan2'), none)).toBe('standby');
    expect(linkStateOf(INDEX, link('vpn-hh-2'), none)).toBe('standby');
  });

  it('links of a planned site carry nothing, whatever else is said', () => {
    expect(linkStateOf(INDEX, link('muc-wan1'), none)).toBe('planned');
    expect(linkStateOf(INDEX, link('vpn-muc-1'), { down: new Set(['vpn-muc-1']), degraded: new Set() })).toBe('planned');
  });

  it('overrides mark links down or degraded', () => {
    const o = { down: new Set(['hh-wan1']), degraded: new Set(['hh-wan2']) };
    expect(linkStateOf(INDEX, link('hh-wan1'), o)).toBe('down');
    expect(linkStateOf(INDEX, link('hh-wan2'), o)).toBe('degraded');
  });
});
