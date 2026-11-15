/**
 * Turns the ids in the explanation into names in the current language and view mode.
 * Simple: what a device is ("Switch"), with the site where it helps. Technical: the hostname.
 * Long lists are shortened ("3 × Wi-Fi access point, Phone", "+4 more").
 */
import { useCallback } from 'react';
import { INDEX } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import type { ActiveFault, ParamValue, TextItem } from '../../engine/explain';
import { roleLabel, serviceLabel, siteLabel } from '../../components/map/labels';

const MAX_LIST = 4;

export function useSimText() {
  const { t, td, lang } = useI18n();
  const { mode } = usePrefs();
  const technical = mode === 'technical';

  const join = useCallback(
    (names: string[]) => {
      if (names.length <= MAX_LIST) return new Intl.ListFormat(lang, { type: 'conjunction' }).format(names);
      return `${names.slice(0, MAX_LIST).join(', ')} ${t('sim.more', { count: names.length - MAX_LIST })}`;
    },
    [lang, t],
  );

  /** One device. `withSite`: add the site in simple mode, where the role alone is ambiguous. */
  const device = useCallback(
    (id: string, withSite = true) => {
      const d = INDEX.devices.get(id);
      if (!d) return id;
      if (technical) return d.name;
      const label = roleLabel(td, d.role);
      return withSite && INDEX.sites.get(d.site)?.kind !== 'external' ? `${label} (${siteLabel(td, d.site)})` : label;
    },
    [technical, td],
  );

  /** Several devices: hostnames, or role labels counted ("3 × Wi-Fi access point") */
  const devices = useCallback(
    (ids: string[]) => {
      if (technical) return join(ids.map((id) => device(id)));
      const counts = new Map<string, number>();
      for (const id of ids) {
        const name = device(id, false);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      return join([...counts].map(([name, n]) => (n > 1 ? t('sim.times', { count: n, name }) : name)));
    },
    [technical, join, device, t],
  );

  const link = useCallback(
    (id: string) => {
      const l = INDEX.links.get(id);
      if (!l) return id;
      return t('sim.linkName', { kind: t(`map.legend.${l.kind}`), a: device(l.a.device, false), b: device(l.b.device, false) });
    },
    [t, device],
  );

  const param = useCallback(
    (name: string, value: ParamValue): string => {
      const list = Array.isArray(value) ? value : [String(value)];
      switch (name) {
        case 'device':
        case 'source':
        case 'host':
          return device(String(value));
        case 'devices':
          return devices(list);
        case 'site':
          return siteLabel(td, String(value));
        case 'sites':
          return join(list.map((s) => siteLabel(td, s)));
        case 'service':
          return serviceLabel(td, String(value));
        case 'services':
          return join(list.map((s) => serviceLabel(td, s)));
        case 'link':
          return link(String(value));
        default:
          return String(value);
      }
    },
    [device, devices, td, join, link],
  );

  const text = useCallback(
    (item: TextItem) => td(item.key, Object.fromEntries(Object.entries(item.params).map(([k, v]) => [k, param(k, v)]))),
    [td, param],
  );

  /** Short name of an active fault for chips: "Switch off · Switch (Clinic Hamburg)" */
  const faultName = useCallback(
    (f: ActiveFault) => `${td(`faults.action.${f.action}.label`)} · ${INDEX.links.has(f.target) ? link(f.target) : device(f.target)}`,
    [td, link, device],
  );

  return { text, device, devices, link, join, faultName };
}
