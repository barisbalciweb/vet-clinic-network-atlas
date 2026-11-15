/**
 * Translation files are nested JSON; the app and the validator work with flat dotted keys:
 * { ui: { nav: { map: "Map" } } } → "ui.nav.map" → "Map"
 */
export type FlatDict = Record<string, string>;

export function flatten(tree: unknown, prefix = '', out: FlatDict = {}): FlatDict {
  if (typeof tree === 'string') {
    out[prefix] = tree;
  } else if (tree && typeof tree === 'object' && !Array.isArray(tree)) {
    for (const [k, v] of Object.entries(tree)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    // Numbers, arrays, null: not allowed in translation files; the validator reports them.
    out[prefix] = '';
  }
  return out;
}

/** Placeholders of a text, sorted: "Hello {name}, {count} new" → ["count", "name"] */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]))].sort();
}

export type Params = Record<string, string | number>;

/** Replaces {name} placeholders; unknown placeholders stay visible so mistakes are noticed. */
export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
