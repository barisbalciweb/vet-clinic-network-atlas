import { describe, expect, it } from 'vitest';
import { flatten, interpolate, placeholders } from '../i18n/flatten';
import { FLAT } from '../i18n/dictionaries';
import { translate } from '../i18n/I18nContext';
import { countSentences, validateI18n } from './validateI18n';

describe('flatten / interpolate', () => {
  it('flattens nested objects to dotted keys', () => {
    expect(flatten({ ui: { nav: { map: 'Map' }, title: 'T' } })).toEqual({ 'ui.nav.map': 'Map', 'ui.title': 'T' });
  });

  it('finds placeholders once, sorted', () => {
    expect(placeholders('{b} and {a} and {b}')).toEqual(['a', 'b']);
  });

  it('replaces known placeholders and keeps unknown ones visible', () => {
    expect(interpolate('ping {ip} from {site}', { ip: '10.2.10.1' })).toBe('ping 10.2.10.1 from {site}');
  });
});

describe('validateI18n', () => {
  const en = { 'a.hello': 'Hello {name}', 'a.bye': 'Bye' };

  it('accepts complete dictionaries', () => {
    expect(validateI18n({ en, de: { 'a.hello': 'Hallo {name}', 'a.bye': 'Tschüss' } })).toEqual([]);
  });

  it('reports a missing key', () => {
    const issues = validateI18n({ en, de: { 'a.hello': 'Hallo {name}' } });
    expect(issues).toEqual([{ severity: 'error', path: 'de › a.bye', message: 'Translation is missing' }]);
  });

  it('reports a key unknown to the reference language', () => {
    const issues = validateI18n({ en, tr: { ...en, 'a.extra': 'x' } });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('tr › a.extra');
  });

  it('reports different placeholders', () => {
    const issues = validateI18n({ en, de: { 'a.hello': 'Hallo {vorname}', 'a.bye': 'Tschüss' } });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Placeholders differ');
  });

  it('warns about long texts and fails very long ones', () => {
    const long = { 'a.hello': `{name} ${'x'.repeat(300)}`, 'a.bye': 'y'.repeat(401) };
    const issues = validateI18n({ en: long });
    expect(issues.map((i) => i.severity)).toEqual(['warning', 'error']);
  });

  it('does not count dots inside IP addresses as sentence ends', () => {
    expect(countSentences('Run ping 10.2.10.1 first. Then check the port.')).toBe(2);
  });
});

describe('the real dictionaries', () => {
  it('have no errors in any language', () => {
    expect(validateI18n(FLAT).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('insert the company name and fall back to the key for unknown keys', () => {
    expect(translate('de', 'ui.app.fictional')).not.toContain('{org}');
    expect(translate('tr', 'no.such.key')).toBe('no.such.key');
  });
});
