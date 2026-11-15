/**
 * Command-line data validation:  npm run validate-data
 * Runs in GitHub Actions before the build, so broken data or a missing translation is never published.
 *
 * Checks the translation files (src/i18n/<lang>/<namespace>.json), then the data files (src/data/*.json),
 * then that every translation key used by the data exists.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { flatten, type FlatDict } from '../src/i18n/flatten';
import { validateI18n, type Issue } from '../src/schema/validateI18n';
import { validateData } from '../src/schema/validateTopology';
import { validateFaultData } from '../src/engine/explain';
import { validateIssues } from '../src/schema/issues';
import { validatePlaybook } from '../src/schema/playbook';
import { validateStandards } from '../src/schema/standards';
import { validateCompliance } from '../src/schema/compliance';
import { buildIndex } from '../src/utils/topologyIndex';

const I18N_DIR = resolve('src/i18n');
const REFERENCE = 'en';
const LANGS = ['en', 'de', 'tr'];

const issues: Issue[] = [];
const dicts: Record<string, FlatDict> = {};
let fileCount = 0;

for (const lang of LANGS) {
  const dir = join(I18N_DIR, lang);
  dicts[lang] = {};
  if (!existsSync(dir)) {
    issues.push({ severity: 'error', path: dir, message: 'Language folder is missing' });
    continue;
  }
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const path = join(dir, file);
    fileCount++;
    try {
      const namespace = file.replace(/\.json$/, '');
      Object.assign(dicts[lang], flatten({ [namespace]: JSON.parse(readFileSync(path, 'utf8')) }));
    } catch (e) {
      issues.push({ severity: 'error', path, message: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
}

issues.push(...validateI18n(dicts, REFERENCE));

// --- Data files ---------------------------------------------------------------------------
const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(resolve('src/data', file), 'utf8'));
  } catch (e) {
    issues.push({ severity: 'error', path: file, message: `Cannot read: ${e instanceof Error ? e.message : String(e)}` });
    return undefined;
  }
};
const data = validateData(readJson('topology.json'), readJson('roles.json'), readJson('cluster.json'));
issues.push(...data.issues);
const usedKeys = [...data.keys];
if (data.topology && data.roles) {
  const faults = validateFaultData(readJson('faults.json'), buildIndex(data.topology, data.roles), data.roles);
  issues.push(...faults.issues);
  usedKeys.push(...faults.keys);
  if (faults.data) {
    const f = faults.data;
    console.log(`✔ Faults: ${f.actions.length} actions, ${f.testSteps.length} test steps, ${f.guides.length} guides, ${f.scenarios.length} scenarios`);
    const iss = validateIssues(readJson('issues.json'), buildIndex(data.topology, data.roles), f);
    issues.push(...iss.issues);
    usedKeys.push(...iss.keys);
    if (iss.data) console.log(`✔ Issues: ${iss.data.issues.length} tickets in ${iss.data.categories.length} categories`);
    const op = validatePlaybook(readJson('playbook.json'), readJson('catalog.json'), buildIndex(data.topology, data.roles));
    issues.push(...op.issues);
    usedKeys.push(...op.keys);
    const st = validateStandards(readJson('standards.json'), buildIndex(data.topology, data.roles));
    issues.push(...st.issues);
    usedKeys.push(...st.keys);
    const co = validateCompliance(readJson('privacy.json'), readJson('monitoring.json'), buildIndex(data.topology, data.roles), f);
    issues.push(...co.issues);
    usedKeys.push(...co.keys);
    if (co.privacy && co.monitoring) console.log(`✔ Compliance: ${co.privacy.measures.length} privacy measures, ${co.monitoring.earlyWarnings.length} early warnings`);
    if (st.data) console.log(`✔ Standards: ${st.data.rollout.length} rollout stages, ${Object.keys(st.data.ansible.outcomes).length} switches in the Ansible run`);
    if (op.playbook && op.catalog) console.log(`✔ Opening: ${op.playbook.phases.length} phases, ${op.playbook.phases.reduce((s, p) => s + p.checklist.length, 0)} steps, ${op.catalog.items.length} catalog items`);
  }
}
for (const { key, where } of usedKeys) {
  if (!(key in dicts[REFERENCE])) issues.push({ severity: 'error', path: where, message: `Translation key "${key}" does not exist` });
}

const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity === 'warning');
warnings.forEach((w) => console.warn(`⚠ ${w.path}: ${w.message}`));
errors.forEach((e) => console.error(`✖ ${e.path}: ${e.message}`));

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s) found.`);
  process.exit(1);
}

if (data.topology) {
  const t = data.topology;
  console.log(`✔ Topology: ${t.sites.length} sites, ${t.zones.length} zones, ${t.devices.length} devices, ${t.links.length} links, ${t.vlans.length} VLANs, ${t.accessPolicy.rules.length} access rules`);
}
console.log(
  `✔ Translations: ${Object.keys(dicts[REFERENCE]).length} keys × ${LANGS.length} languages in ${fileCount} files` +
    (warnings.length ? ` – ${warnings.length} warning(s)` : ''),
);
