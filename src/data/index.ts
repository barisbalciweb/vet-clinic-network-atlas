/**
 * The app's data, validated and expanded once at start-up.
 * `npm run validate-data` runs the same validation before every build, so a failure here
 * never reaches production; in development it stops with a readable message.
 */
import rawTopology from './topology.json';
import rawRoles from './roles.json';
import rawCluster from './cluster.json';
import rawFaults from './faults.json';
import rawIssues from './issues.json';
import rawPlaybook from './playbook.json';
import rawCatalog from './catalog.json';
import rawStandards from './standards.json';
import rawPrivacy from './privacy.json';
import rawMonitoring from './monitoring.json';
import { validateCompliance } from '../schema/compliance';
import { validateStandards } from '../schema/standards';
import { validatePlaybook } from '../schema/playbook';
import type { Topology } from '../schema/topology.schema';
import { validateIssues } from '../schema/issues';
import { validateFaultData } from '../engine/explain';
import { validateData } from '../schema/validateTopology';
import { buildIndex } from '../utils/topologyIndex';

const result = validateData(rawTopology, rawRoles, rawCluster);
if (!result.ok || !result.topology || !result.roles || !result.cluster) {
  const lines = result.issues.filter((i) => i.severity === 'error').map((i) => `${i.path}: ${i.message}`);
  throw new Error(`Invalid data files:\n${lines.join('\n')}`);
}

export const INDEX = buildIndex(result.topology, result.roles);
export const TOPOLOGY = result.topology;
export const ROLES = result.roles;
export const CLUSTER = result.cluster;

const faults = validateFaultData(rawFaults, INDEX, result.roles);
if (!faults.data || faults.issues.some((i) => i.severity === 'error')) {
  throw new Error(`Invalid faults.json:\n${faults.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`);
}
export const FAULTS = faults.data;

const issues = validateIssues(rawIssues, INDEX, FAULTS);
if (!issues.data || issues.issues.some((i) => i.severity === 'error')) {
  throw new Error(`Invalid issues.json:\n${issues.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`);
}
export const ISSUES = issues.data;

const opening = validatePlaybook(rawPlaybook, rawCatalog, INDEX);
if (!opening.playbook || !opening.catalog || opening.issues.some((i) => i.severity === 'error')) {
  throw new Error(`Invalid playbook.json or catalog.json:\n${opening.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`);
}
export const PLAYBOOK = opening.playbook;
export const CATALOG = opening.catalog;

const standards = validateStandards(rawStandards, INDEX);
if (!standards.data || standards.issues.some((i) => i.severity === 'error')) {
  throw new Error(`Invalid standards.json:\n${standards.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`);
}
export const STANDARDS = standards.data;

const compliance = validateCompliance(rawPrivacy, rawMonitoring, INDEX, FAULTS);
if (!compliance.privacy || !compliance.monitoring || compliance.issues.some((i) => i.severity === 'error')) {
  throw new Error(`Invalid privacy.json or monitoring.json:\n${compliance.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`);
}
export const PRIVACY = compliance.privacy;
export const MONITORING = compliance.monitoring;

/** The same network after the opening: the planned site is live */
export const TOPOLOGY_OPENED: Topology = {
  ...result.topology,
  sites: result.topology.sites.map((s) => (s.id === PLAYBOOK.site ? { ...s, status: 'live' as const } : s)),
};
