/**
 * Checks the translation dictionaries. English is the reference.
 *
 * Errors:   key missing in a language, key that does not exist in English, empty or non-text value,
 *           different {placeholders} than English, text far beyond the length rule.
 * Warnings: text longer than "about 3 short sentences" (brief, section 2).
 *
 * Pure function – used by scripts/validate-data.ts and by the tests.
 */
import { placeholders, type FlatDict } from '../i18n/flatten';

export interface Issue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

export const WARN_LENGTH = 280;
export const MAX_LENGTH = 400;
export const MAX_SENTENCES = 3;

/** Sentence ends: . ! ? followed by a space or the end. "10.2.10.1" and "e.g. x" style dots inside words do not count. */
export function countSentences(text: string): number {
  return text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim().length > 0).length;
}

export function validateI18n(dicts: Record<string, FlatDict>, reference = 'en'): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Issue['severity'], path: string, message: string) => issues.push({ severity, path, message });
  const ref = dicts[reference];
  if (!ref) return [{ severity: 'error', path: reference, message: 'Reference language is missing' }];

  for (const [lang, dict] of Object.entries(dicts)) {
    for (const key of Object.keys(ref)) {
      if (!(key in dict)) add('error', `${lang} › ${key}`, 'Translation is missing');
    }
    for (const [key, text] of Object.entries(dict)) {
      const path = `${lang} › ${key}`;
      if (!(key in ref)) {
        add('error', path, `Key does not exist in the reference language (${reference})`);
        continue;
      }
      if (text.trim() === '') {
        add('error', path, 'Text is empty or not a string');
        continue;
      }
      const want = placeholders(ref[key]).join(', ');
      const got = placeholders(text).join(', ');
      if (want !== got) add('error', path, `Placeholders differ from ${reference}: expected {${want}}, found {${got}}`);

      if (text.length > MAX_LENGTH) add('error', path, `Text has ${text.length} characters (limit ${MAX_LENGTH})`);
      else if (text.length > WARN_LENGTH) add('warning', path, `Text has ${text.length} characters (aim for under ${WARN_LENGTH})`);
      else if (countSentences(text) > MAX_SENTENCES) add('warning', path, `Text has more than ${MAX_SENTENCES} sentences`);
    }
  }
  return issues;
}
