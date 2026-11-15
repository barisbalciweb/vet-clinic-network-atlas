/**
 * Display texts derived from the data. Text keys follow the id conventions of docs/SCHEMA.md:
 * roles.<role>.label, topology.site.<id>.label, topology.vlan.<id>.label, topology.service.<id>.
 */
import type { Device, Zone } from '../../schema/topology.schema';
import type { ViewMode } from '../../context/PrefsContext';
import type { Params } from '../../i18n/flatten';

export type Td = (key: string, params?: Params) => string;

export const roleLabel = (td: Td, role: string) => td(`roles.${role}.label`);
export const roleSummary = (td: Td, role: string, mode: ViewMode) => td(`roles.${role}.${mode}`);
export const siteLabel = (td: Td, siteId: string) => td(`topology.site.${siteId}.label`);
export const vlanLabel = (td: Td, vlan: number) => td(`topology.vlan.${vlan}.label`);
export const serviceLabel = (td: Td, serviceId: string) => td(`topology.service.${serviceId}`);
export const zoneLabel = (td: Td, zone: Zone) => td(zone.labelKey, zone.number !== undefined ? { n: zone.number } : undefined);

/** Simple: what the device is. Technical: its hostname. */
export const devicePrimary = (td: Td, d: Device, mode: ViewMode) => (mode === 'technical' ? d.name : roleLabel(td, d.role));
