/**
 * State of a link on the map. Pure function, no drawing.
 *
 *   up        normal line
 *   degraded  amber with a "!" marker (packet loss, slow line, failover path in use)
 *   down      red and dashed with a "✕" marker
 *   standby   backup path that carries nothing right now: lighter line
 *   planned   belongs to a site that is not live yet: lighter line
 *
 * The map normally takes the state from the simulation (SimContext); this function is the
 * fallback for links the simulation does not know.
 */
import type { Link } from '../../schema/topology.schema';
import type { TopologyIndex } from '../../utils/topologyIndex';

export type LinkState = 'up' | 'degraded' | 'down' | 'standby' | 'planned';

export interface StateOverrides {
  down: ReadonlySet<string>;
  degraded: ReadonlySet<string>;
}

/** State of a link without any simulation: explicit overrides first, then what the data says. */
export function linkStateOf(index: TopologyIndex, link: Link, overrides: StateOverrides): LinkState {
  const planned = [link.a.device, link.b.device].some((id) => index.sites.get(index.devices.get(id)?.site ?? '')?.status === 'planned');
  if (planned) return 'planned';
  if (overrides.down.has(link.id)) return 'down';
  if (overrides.degraded.has(link.id)) return 'degraded';
  return link.role === 'backup' ? 'standby' : 'up';
}
