/**
 * Evaluates the access policy (topology.accessPolicy) for one source VLAN and one destination.
 *
 * Rules are evaluated top to bottom like a firewall rule set:
 *  - a matching permit rule WITH services only allows those services → collected, evaluation continues
 *  - the first matching rule WITHOUT services decides: permit → allowed, deny → denied
 *    (or "limited", if services were collected before the deny)
 *  - if nothing decides, the policy's defaultAction applies
 * Traffic inside the same VLAN is not routed through the firewall, so it is always allowed –
 * except in the guest network, where client isolation on the access points blocks it.
 */
import type { AccessPolicy, AccessRule } from '../schema/topology.schema';

export type AccessTarget = number | 'internet' | 'hq-servers';
export type AccessStatus = 'allowed' | 'limited' | 'denied' | 'same';

export interface AccessResult {
  status: AccessStatus;
  /** Translation keys of the allowed services when status is "limited" */
  serviceKeys: string[];
  /** Translation keys of the rules that produced this result */
  reasonKeys: string[];
}

const matches = (list: Array<number | string>, value: number | string) => list.includes('any') || list.includes(value);

export function evaluateAccess(policy: AccessPolicy, from: number, to: AccessTarget): AccessResult {
  if (from === to) return { status: 'same', serviceKeys: [], reasonKeys: [] };
  const serviceKeys: string[] = [];
  const reasonKeys: string[] = [];
  const finish = (action: AccessRule['action'], rule?: AccessRule): AccessResult => {
    if (rule) reasonKeys.push(rule.descriptionKey);
    if (action === 'permit') return { status: 'allowed', serviceKeys: [], reasonKeys };
    return serviceKeys.length ? { status: 'limited', serviceKeys, reasonKeys } : { status: 'denied', serviceKeys: [], reasonKeys };
  };

  for (const rule of policy.rules) {
    if (!matches(rule.from, from) || !matches(rule.to, to)) continue;
    if (rule.action === 'permit' && rule.serviceKeys?.length) {
      serviceKeys.push(...rule.serviceKeys);
      reasonKeys.push(rule.descriptionKey);
      continue;
    }
    return finish(rule.action, rule);
  }
  return finish(policy.defaultAction);
}
