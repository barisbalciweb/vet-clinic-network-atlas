/**
 * Addressing plan: 10.<site>.<vlan>.0/24, gateway .1 – the same in every site.
 * Subnets are computed from the site number and never stored in the data.
 */
export function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export const subnetPrefix = (siteNumber: number, vlan: number) => `10.${siteNumber}.${vlan}.`;
export const subnetOf = (siteNumber: number, vlan: number) => `${subnetPrefix(siteNumber, vlan)}0/24`;
export const gatewayOf = (siteNumber: number, vlan: number) => `${subnetPrefix(siteNumber, vlan)}1`;

/** Subnet with a placeholder for the site, for tables that apply to every site: "10.<site>.20.0/24" */
export const subnetPattern = (vlan: number, sitePlaceholder: string) => `10.<${sitePlaceholder}>.${vlan}.0/24`;

export function inSubnet(ip: string, siteNumber: number, vlan: number): boolean {
  if (!isValidIPv4(ip) || !ip.startsWith(subnetPrefix(siteNumber, vlan))) return false;
  const host = Number(ip.split('.')[3]);
  return host >= 1 && host <= 254;
}

/** Sort key: 10.2.10.11 → comparable number */
export const ipToNumber = (ip: string) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
