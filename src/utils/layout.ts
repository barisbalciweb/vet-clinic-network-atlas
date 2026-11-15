/**
 * Turns the topology into React Flow nodes and edges.
 *
 * Two canvases:
 *  - overview: one node per site at its position on the Germany schematic, edges = links between sites
 *  - site:     zones as boxes (rows from the data: `row`, `cols`), devices in a grid inside,
 *              and one "portal" node per neighbouring site for links that leave the site
 *
 * The layout is computed, not stored, and it is deterministic: the same data always gives the
 * same picture, and it does not depend on the language.
 */
import type { Edge, Node } from '@xyflow/react';
import type { Link, Zone } from '../schema/topology.schema';
import type { TopologyIndex } from './topologyIndex';

export const DEVICE_W = 214;
export const DEVICE_H = 60;
const GAP_X = 14;
const GAP_Y = 14;
const ZONE_PAD = { top: 40, side: 14, bottom: 14 };
const ZONE_GAP = 28;
const ROW_GAP = 64;
/** Zones of one row wrap to a second line beyond this width */
const MAX_ROW_W = 1700;
export const PORTAL_W = 220;
export const PORTAL_H = 56;

/** Overview: pixels per map unit, and the size of a site node */
export const MAP_SCALE = 5.2;
export const MAP_W = 100;
export const MAP_H = 122;
export const SITE_W = 200;
export const SITE_H = 66;

export type DeviceFlowNode = Node<{ deviceId: string }, 'device'>;
export type ZoneFlowNode = Node<{ zoneId: string }, 'zone'>;
export type PortalFlowNode = Node<{ siteId: string }, 'portal'>;
export type SiteFlowNode = Node<{ siteId: string }, 'site'>;
export type BackdropFlowNode = Node<Record<string, never>, 'backdrop'>;
export type FlowNode = DeviceFlowNode | ZoneFlowNode | PortalFlowNode | SiteFlowNode | BackdropFlowNode;
export type LinkFlowEdge = Edge<{ linkId: string; parallelIndex: number; parallelCount: number }, 'link'>;

export interface Layout {
  nodes: FlowNode[];
  edges: LinkFlowEdge[];
}

export const portalId = (siteId: string) => `portal:${siteId}`;
export const siteNodeId = (siteId: string) => `site:${siteId}`;
export const zoneNodeId = (zoneId: string) => `zone:${zoneId}`;

/**
 * One edge per link whose two ends map to different nodes. Parallel links between the same two
 * nodes (e.g. primary and backup tunnel) get an index so the edge can draw them side by side.
 * Source/target are ordered by id, so all parallel edges of a pair point the same way.
 */
function buildEdges(links: Link[], nodeOf: (deviceId: string) => string | undefined): LinkFlowEdge[] {
  const pairs = new Map<string, LinkFlowEdge[]>();
  for (const l of links) {
    const a = nodeOf(l.a.device);
    const b = nodeOf(l.b.device);
    if (!a || !b || a === b) continue;
    const [source, target] = a < b ? [a, b] : [b, a];
    const key = `${source}|${target}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key)!.push({ id: l.id, type: 'link', source, target, data: { linkId: l.id, parallelIndex: 0, parallelCount: 1 }, focusable: false });
  }
  const edges: LinkFlowEdge[] = [];
  for (const group of pairs.values()) {
    group.forEach((e, i) => {
      e.data = { linkId: e.id, parallelIndex: i, parallelCount: group.length };
      edges.push(e);
    });
  }
  return edges;
}

/** Overview of all sites on the Germany schematic. */
export function layoutOverview(index: TopologyIndex): Layout {
  const nodes: FlowNode[] = [
    {
      id: 'backdrop',
      type: 'backdrop',
      position: { x: 0, y: 0 },
      data: {},
      width: MAP_W * MAP_SCALE,
      height: MAP_H * MAP_SCALE,
      selectable: false,
      focusable: false,
      zIndex: 0,
    },
  ];
  for (const s of index.topology.sites) {
    nodes.push({
      id: siteNodeId(s.id),
      type: 'site',
      position: { x: s.map.x * MAP_SCALE - SITE_W / 2, y: s.map.y * MAP_SCALE - SITE_H / 2 },
      data: { siteId: s.id },
      width: SITE_W,
      height: SITE_H,
      focusable: false,
      zIndex: 2,
    });
  }
  const edges = buildEdges(index.topology.links, (id) => {
    const d = index.devices.get(id);
    return d ? siteNodeId(d.site) : undefined;
  });
  return { nodes, edges };
}

interface Box {
  zone: Zone;
  w: number;
  h: number;
  cols: number;
  deviceIds: string[];
}

/** One site: zones in rows, devices in a grid inside each zone, portals to neighbouring sites on top. */
export function layoutSite(index: TopologyIndex, siteId: string): Layout {
  const devices = index.devicesOfSite(siteId);
  const local = new Set(devices.map((d) => d.id));

  // Zone boxes, grouped by row
  const rows = new Map<number, Box[]>();
  for (const zone of index.zonesOfSite(siteId)) {
    const deviceIds = devices.filter((d) => d.zone === zone.id).map((d) => d.id);
    if (deviceIds.length === 0) continue;
    const cols = Math.min(zone.cols ?? 3, deviceIds.length);
    const lines = Math.ceil(deviceIds.length / cols);
    const w = ZONE_PAD.side * 2 + cols * DEVICE_W + (cols - 1) * GAP_X;
    const h = ZONE_PAD.top + lines * DEVICE_H + (lines - 1) * GAP_Y + ZONE_PAD.bottom;
    if (!rows.has(zone.row)) rows.set(zone.row, []);
    rows.get(zone.row)!.push({ zone, w, h, cols, deviceIds });
  }

  // Wrap long rows, then stack the lines and centre each one
  const lines: Box[][] = [];
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    let line: Box[] = [];
    let width = 0;
    for (const box of rows.get(row)!) {
      if (line.length && width + ZONE_GAP + box.w > MAX_ROW_W) {
        lines.push(line);
        line = [];
        width = 0;
      }
      width += (line.length ? ZONE_GAP : 0) + box.w;
      line.push(box);
    }
    if (line.length) lines.push(line);
  }
  const lineWidth = (line: Box[]) => line.reduce((sum, b) => sum + b.w, 0) + (line.length - 1) * ZONE_GAP;
  const totalW = Math.max(0, ...lines.map(lineWidth));

  const nodes: FlowNode[] = [];
  let y = 0;
  for (const line of lines) {
    let x = (totalW - lineWidth(line)) / 2;
    for (const box of line) {
      nodes.push({
        id: zoneNodeId(box.zone.id),
        type: 'zone',
        position: { x, y },
        data: { zoneId: box.zone.id },
        width: box.w,
        height: box.h,
        selectable: false,
        focusable: false,
        // Below the link lines, so lines and animals stay fully visible inside a room
        zIndex: -1,
      });
      box.deviceIds.forEach((id, i) => {
        nodes.push({
          id,
          type: 'device',
          position: {
            x: x + ZONE_PAD.side + (i % box.cols) * (DEVICE_W + GAP_X),
            y: y + ZONE_PAD.top + Math.floor(i / box.cols) * (DEVICE_H + GAP_Y),
          },
          data: { deviceId: id },
          width: DEVICE_W,
          height: DEVICE_H,
          focusable: false,
          zIndex: 2,
        });
      });
      x += box.w + ZONE_GAP;
    }
    y += Math.max(...line.map((b) => b.h)) + ROW_GAP;
  }

  // Portals: the neighbouring sites that links from here lead to
  const remoteSites: string[] = [];
  const siteLinks: Link[] = [];
  for (const l of index.topology.links) {
    const inA = local.has(l.a.device);
    const inB = local.has(l.b.device);
    if (!inA && !inB) continue;
    siteLinks.push(l);
    if (inA && inB) continue;
    const remote = index.devices.get(inA ? l.b.device : l.a.device)?.site;
    if (remote && !remoteSites.includes(remote)) remoteSites.push(remote);
  }
  const portalsW = remoteSites.length * PORTAL_W + (remoteSites.length - 1) * ZONE_GAP * 2;
  remoteSites.forEach((id, i) => {
    nodes.push({
      id: portalId(id),
      type: 'portal',
      position: { x: (totalW - portalsW) / 2 + i * (PORTAL_W + ZONE_GAP * 2), y: -(PORTAL_H + ROW_GAP + 10) },
      data: { siteId: id },
      width: PORTAL_W,
      height: PORTAL_H,
      focusable: false,
      zIndex: 2,
    });
  });

  const edges = buildEdges(siteLinks, (id) => {
    if (local.has(id)) return id;
    const remote = index.devices.get(id)?.site;
    return remote ? portalId(remote) : undefined;
  });
  return { nodes, edges };
}
