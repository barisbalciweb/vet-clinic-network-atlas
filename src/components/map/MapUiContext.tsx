/**
 * What the nodes and edges on the canvas need from the map page:
 * which device is selected, and how to select a device, open a site or show a hover summary.
 */
import { createContext, useContext } from 'react';
import type { LinkState } from './linkState';
import type { DeviceSimState } from '../../context/SimContext';
import type { Quality } from '../../engine/types';

export interface HoverInfo {
  title: string;
  subtitle?: string;
  text: string;
  rect: DOMRect;
}

export interface MapUi {
  selectedId: string | null;
  /** The site shown on the canvas is planned (not live): drawn outlined */
  planned: boolean;
  selectDevice: (id: string) => void;
  clearSelection: () => void;
  openSite: (id: string) => void;
  setHover: (info: HoverInfo | null) => void;
  /** Current state of a link (up, degraded, down, standby, planned) */
  linkState: (linkId: string) => LinkState;
  /** Simulated state of a device; undefined while nothing is broken */
  deviceState: (id: string) => DeviceSimState | undefined;
  siteState: (id: string) => Quality | undefined;
  /** live or planned right now (München goes live through Module D) */
  siteStatus: (id: string) => 'live' | 'planned';
  /** Data protection layer: personal data categories per device, or null when the layer is off */
  privacyCats: ((id: string) => string[] | undefined) | null;
  /** Devices highlighted for a common issue; null = no highlight */
  highlight: ReadonlySet<string> | null;
}

export const MapUiContext = createContext<MapUi | null>(null);

export function useMapUi(): MapUi {
  const v = useContext(MapUiContext);
  if (!v) throw new Error('useMapUi must be used inside the map page');
  return v;
}
