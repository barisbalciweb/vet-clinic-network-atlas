/**
 * Schema and validation of src/data/issues.json (Module C, common issues).
 *
 * The data holds structure only; texts are found by convention:
 *   issues.category.<category>
 *   issues.item.<id>.symptom | .solution | .causes.<1..n> | .checks.<1..n> | .warning (if `warning`)
 * `causes` and `checks` in the data are the number of entries, so the validator can demand
 * every one of them in every language.
 */
import { z } from 'zod';
import type { Issue } from './validateI18n';
import type { TopologyIndex } from '../utils/topologyIndex';
import { buildFault, type FaultData } from '../engine/explain';

const id = z.string().regex(/^[a-z0-9-]+$/);

export const issueSchema = z
  .object({
    id,
    category: id,
    /** incident: something is broken · request: a planned task (on- and offboarding) */
    kind: z.enum(['incident', 'request']),
    /** Stops the clinic from earning money or puts data at risk: shown with a badge */
    critical: z.boolean().optional(),
    /** Has a "watch out" text: the mistake that makes things worse */
    warning: z.boolean().optional(),
    causes: z.number().int().min(1).max(3),
    checks: z.number().int().min(1).max(4),
    /** "Show on map": the site to open and the roles to highlight */
    show: z.object({ site: id, roles: z.array(id).min(1) }).strict(),
    /** "Simulate": faults for the failure simulator */
    simulate: z.array(z.object({ action: id, target: z.string() }).strict()).optional(),
  })
  .strict();

export const issuesFileSchema = z.object({ categories: z.array(id).min(1), issues: z.array(issueSchema) }).strict();

export type IssueItem = z.infer<typeof issueSchema>;
export type IssuesFile = z.infer<typeof issuesFileSchema>;

export function issueKeys(item: IssueItem): string[] {
  const base = `issues.item.${item.id}`;
  return [
    `${base}.symptom`,
    `${base}.solution`,
    ...Array.from({ length: item.causes }, (_, i) => `${base}.causes.${i + 1}`),
    ...Array.from({ length: item.checks }, (_, i) => `${base}.checks.${i + 1}`),
    ...(item.warning ? [`${base}.warning`] : []),
  ];
}

export function validateIssues(raw: unknown, index: TopologyIndex, faults: FaultData): { issues: Issue[]; data?: IssuesFile; keys: Array<{ key: string; where: string }> } {
  const issues: Issue[] = [];
  const keys: Array<{ key: string; where: string }> = [];
  const err = (path: string, message: string) => issues.push({ severity: 'error', path: `issues.json › ${path}`, message });
  const parsed = issuesFileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) err(i.path.join(' › ') || '(root)', i.message);
    return { issues, keys };
  }
  const data = parsed.data;
  const categories = new Set(data.categories);
  const seen = new Set<string>();
  for (const c of data.categories) keys.push({ key: `issues.category.${c}`, where: `issues.json › category "${c}"` });

  for (const item of data.issues) {
    const at = `issue "${item.id}"`;
    if (seen.has(item.id)) err(at, 'Id is used more than once');
    seen.add(item.id);
    if (!categories.has(item.category)) err(at, `Category "${item.category}" is not listed in "categories"`);
    if (!index.sites.has(item.show.site)) err(`${at} › show`, `Site "${item.show.site}" is not defined`);
    for (const r of item.show.roles) if (!index.roles.has(r)) err(`${at} › show`, `Role "${r}" is not defined`);
    for (const f of item.simulate ?? []) {
      if (!buildFault(faults, index, f.action, f.target)) err(`${at} › simulate`, `Action "${f.action}" cannot be applied to "${f.target}"`);
    }
    for (const key of issueKeys(item)) keys.push({ key, where: `issues.json › ${at}` });
  }
  return { issues, data, keys };
}

/** Devices to highlight for an issue: its roles in the shown site, plus HQ and cloud devices of those roles. */
export function highlightFor(item: IssueItem, index: TopologyIndex): Set<string> {
  const roles = new Set(item.show.roles);
  return new Set(
    index.topology.devices
      .filter((d) => roles.has(d.role) && (d.site === item.show.site || index.sites.get(d.site)?.kind !== 'clinic'))
      .map((d) => d.id),
  );
}
