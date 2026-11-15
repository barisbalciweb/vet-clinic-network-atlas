/**
 * The modules A–H: one entry = one page, one navigation item, one route.
 * Texts are looked up by id: ui.nav.<id>, ui.modules.<id>.title / .simple / .technical
 */
import { Activity, CalendarCheck, HeartPulse, LayoutTemplate, LifeBuoy, Map as MapIcon, ShieldCheck, Zap, type LucideIcon } from 'lucide-react';

export const MODULE_IDS = ['map', 'simulator', 'issues', 'opening', 'standards', 'haLab', 'privacy', 'monitoring'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export interface ModuleDef {
  id: ModuleId;
  /** Letter used in the brief (A–H) */
  letter: string;
  /** Hash route: "#/<path>". The map is the home page ("#/"). */
  path: string;
  icon: LucideIcon;
}

export const MODULES: ModuleDef[] = [
  { id: 'map', letter: 'A', path: '', icon: MapIcon },
  { id: 'simulator', letter: 'B', path: 'simulator', icon: Zap },
  { id: 'issues', letter: 'C', path: 'issues', icon: LifeBuoy },
  { id: 'opening', letter: 'D', path: 'opening', icon: CalendarCheck },
  { id: 'standards', letter: 'E', path: 'standards', icon: LayoutTemplate },
  { id: 'haLab', letter: 'F', path: 'ha-lab', icon: HeartPulse },
  { id: 'privacy', letter: 'G', path: 'privacy', icon: ShieldCheck },
  { id: 'monitoring', letter: 'H', path: 'monitoring', icon: Activity },
];

export const ABOUT_PATH = 'about';

/** Unknown routes fall back to the map. */
export function moduleForPath(path: string): ModuleDef {
  return MODULES.find((m) => m.path === path) ?? MODULES[0];
}
