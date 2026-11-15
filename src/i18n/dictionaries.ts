/**
 * All translation files, one folder per language and one file per namespace.
 * English is the reference: `satisfies Dictionary` makes a missing key in de/tr a type error,
 * and `npm run validate-data` checks the same (plus placeholders and text length) on the JSON files.
 *
 * Adding a namespace: create <name>.json in en/, de/ and tr/ and list it three times below.
 */
import enUi from './en/ui.json';
import enMap from './en/map.json';
import enTopology from './en/topology.json';
import enRoles from './en/roles.json';
import enSim from './en/sim.json';
import enFaults from './en/faults.json';
import enHa from './en/ha.json';
import enIssues from './en/issues.json';
import enOpening from './en/opening.json';
import enShop from './en/shop.json';
import enStd from './en/std.json';
import enPrivacy from './en/privacy.json';
import enMon from './en/mon.json';
import deUi from './de/ui.json';
import deMap from './de/map.json';
import deTopology from './de/topology.json';
import deRoles from './de/roles.json';
import deSim from './de/sim.json';
import deFaults from './de/faults.json';
import deHa from './de/ha.json';
import deIssues from './de/issues.json';
import deOpening from './de/opening.json';
import deShop from './de/shop.json';
import deStd from './de/std.json';
import dePrivacy from './de/privacy.json';
import deMon from './de/mon.json';
import trUi from './tr/ui.json';
import trMap from './tr/map.json';
import trTopology from './tr/topology.json';
import trRoles from './tr/roles.json';
import trSim from './tr/sim.json';
import trFaults from './tr/faults.json';
import trHa from './tr/ha.json';
import trIssues from './tr/issues.json';
import trOpening from './tr/opening.json';
import trShop from './tr/shop.json';
import trStd from './tr/std.json';
import trPrivacy from './tr/privacy.json';
import trMon from './tr/mon.json';
import { flatten, type FlatDict } from './flatten';

export const LANGS = ['en', 'de', 'tr'] as const;
export type Lang = (typeof LANGS)[number];

/** Language names are shown in their own language and never translated. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', de: 'Deutsch', tr: 'Türkçe' };

const en = { ui: enUi, map: enMap, topology: enTopology, roles: enRoles, sim: enSim, faults: enFaults, ha: enHa, issues: enIssues, opening: enOpening, shop: enShop, std: enStd, privacy: enPrivacy, mon: enMon };
type Dictionary = typeof en;
const de = { ui: deUi, map: deMap, topology: deTopology, roles: deRoles, sim: deSim, faults: deFaults, ha: deHa, issues: deIssues, opening: deOpening, shop: deShop, std: deStd, privacy: dePrivacy, mon: deMon } satisfies Dictionary;
const tr = { ui: trUi, map: trMap, topology: trTopology, roles: trRoles, sim: trSim, faults: trFaults, ha: trHa, issues: trIssues, opening: trOpening, shop: trShop, std: trStd, privacy: trPrivacy, mon: trMon } satisfies Dictionary;

/** "ui.nav.map" | "ui.header.menu" | ... – every key that exists in English */
type Leaves<T, P extends string = ''> = T extends string
  ? P
  : { [K in keyof T & string]: Leaves<T[K], P extends '' ? K : `${P}.${K}`> }[keyof T & string];
export type TKey = Leaves<Dictionary>;

export const FLAT: Record<Lang, FlatDict> = { en: flatten(en), de: flatten(de), tr: flatten(tr) };
