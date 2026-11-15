/**
 * Types of the simulation engine. The engine is pure: data in, result out, no UI and no text.
 * Everything a person reads is produced later from this result and the text keys in the data files.
 */

/** What is broken. `site` / `vlan` narrow a service fault ("DHCP pool of the guest VLAN in Hamburg"). */
export type FaultTarget =
  | { kind: 'device'; id: string }
  | { kind: 'link'; id: string }
  | { kind: 'service'; id: string; site?: string; vlan?: number };

export type FaultType = 'power-off' | 'link-cut' | 'degrade' | 'service-failure';
export type FaultVariant = 'stopped' | 'dns-stopped' | 'dhcp-exhausted' | 'cert-expired' | 'tunnel-down';

export interface Fault {
  type: FaultType;
  target: FaultTarget;
  variant?: FaultVariant;
  /** service-failure on a device: only this service of the device fails (the device stays on) */
  service?: string;
}

export type Quality = 'up' | 'degraded' | 'down';

export type CauseReason =
  | 'fault' // the element itself is broken
  | 'no-power' // its power source is gone
  | 'host-down' // VM: its host failed and it could not be restarted
  | 'no-capacity' // VM: no host has room for it
  | 'no-storage' // VM: no host reaches the storage
  | 'unreachable' // no usable path to what is needed
  | 'service-down' // the service itself failed
  | 'backup-path' // works, but only over the backup path
  | 'poor-link' // works, but over a degraded link or device
  | 'restarted'; // works again after an HA restart (short outage)

export interface Cause {
  /** Index into the fault list that is responsible; -1 if none could be determined */
  fault: number;
  reason: CauseReason;
  /** The element where it breaks (device or link id) */
  via?: string;
}

export interface DeviceResult {
  /** Powered and running (for a VM: placed on a host) */
  on: boolean;
  /** What it can still do: up, degraded, or down (off, or on but unable to do its job) */
  state: Quality;
  cause?: Cause;
  /** VM: the host it runs on now */
  host?: string;
  /** VM: was restarted on another host by HA */
  restarted?: boolean;
  /** UPS: running on battery */
  onBattery?: boolean;
}

export type LinkStatus = 'up' | 'degraded' | 'down' | 'standby' | 'planned';

export interface LinkResult {
  state: LinkStatus;
  /** A backup path that carries traffic right now (failover active) */
  carrying: boolean;
  cause?: Cause;
}

export interface CapabilityResult {
  device: string;
  site: string;
  role: string;
  capability: string;
  audience: string;
  state: Quality;
  /** The need that failed or is degraded: a service id or "role:<role>" */
  need?: string;
  /** The device is not on the network at all (the failed need is one of its basic ones) */
  offNetwork?: boolean;
  cause?: Cause;
}

export interface SiteResult {
  /** Internet uplink of the site */
  wan: 'primary' | 'backup' | 'offline';
  /** Clinics: tunnel to HQ */
  vpn?: 'primary' | 'backup' | 'down';
  state: Quality;
}

export type ChainKind =
  | 'fault'
  | 'power-lost'
  | 'on-battery'
  | 'vm-restarted'
  | 'vm-down'
  | 'wan-failover'
  | 'site-offline'
  | 'vpn-failover'
  | 'vpn-down'
  | 'roaming'
  | 'service-down'
  | 'service-degraded';

/** One step of the chain reaction, in the order it happens. */
export interface ChainEvent {
  kind: ChainKind;
  /** Device, link, site or service the step is about */
  subject: string;
  site?: string;
  /** Extra ids for the text: { from, to, service, ap, ... } */
  params: Record<string, string>;
  fault: number;
}

export type WarningKind = 'redundancy-lost' | 'capacity-reserve-used' | 'on-battery' | 'service-redundancy-lost';

/** Nothing is down, but a safety margin is gone. */
export interface Warning {
  kind: WarningKind;
  /** Redundancy group, service or device */
  subject: string;
  /** Members that are missing */
  missing: string[];
}

/** Capabilities that do not work, grouped the way people are told about it. */
export interface Affected {
  site: string;
  audience: string;
  capability: string;
  role: string;
  state: Exclude<Quality, 'up'>;
  devices: string[];
  need?: string;
  offNetwork?: boolean;
  cause?: Cause;
}

export interface SimulationResult {
  faults: Fault[];
  devices: Record<string, DeviceResult>;
  links: Record<string, LinkResult>;
  capabilities: CapabilityResult[];
  sites: Record<string, SiteResult>;
  chain: ChainEvent[];
  affected: Affected[];
  warnings: Warning[];
  /** No fault changes anything for anyone (absorbed by redundancy, or nothing is broken) */
  healthy: boolean;
}
