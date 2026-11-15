/**
 * Content of the details panel for one device: what it is, where it is, its address and network,
 * what it needs, what it provides and what depends on it.
 * Simple view: plain language and the dependency lists. Technical view adds model, power,
 * redundancy group and the individual connections with ports.
 */
import type { ReactNode } from 'react';
import { INDEX } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import type { Device } from '../../schema/topology.schema';
import { RoleIcon } from '../map/RoleIcon';
import { devicePrimary, roleLabel, roleSummary, serviceLabel, siteLabel, zoneLabel } from '../map/labels';
import { VlanBadge } from '../common/VlanBadge';
import { Section } from './SidePanel';
import { serviceNeeds } from '../../utils/topologyIndex';

const MAX_DEPENDENTS = 8;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-28 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{children}</dd>
    </div>
  );
}

/** `children` are shown right below the summary (the simulator puts its fault actions there). */
export function DeviceDetails({ device, onSelect, children }: { device: Device; onSelect: (id: string) => void; children?: ReactNode }) {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const technical = mode === 'technical';
  const role = INDEX.roles.get(device.role);
  const zone = INDEX.zones.get(device.zone);
  const subnet = INDEX.subnetOfDevice(device);
  const dependents = INDEX.dependentsOf(device.id);
  const provided = INDEX.providedBy(device.id);
  const needs = serviceNeeds(role);
  const peers = device.group ? INDEX.topology.devices.filter((d) => d.group === device.group && d.id !== device.id) : [];
  const name = (d: Device) => devicePrimary(td, d, mode);

  const DeviceLink = ({ d }: { d: Device }) => (
    <button type="button" onClick={() => onSelect(d.id)} className="rounded text-left font-medium text-primary-strong underline-offset-2 hover:underline">
      {name(d)}
      {d.site !== device.site && <span className="font-normal text-muted"> · {siteLabel(td, d.site)}</span>}
    </button>
  );

  return (
    <div>
      <div className="flex items-center gap-3 pr-10">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
          <RoleIcon icon={role?.icon} className="h-6 w-6" />
        </span>
        <div className="min-w-0 leading-tight">
          <h2 className="truncate text-base font-semibold text-ink">{roleLabel(td, device.role)}</h2>
          <div className="truncate font-mono text-xs text-muted">{device.name}</div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink">{roleSummary(td, device.role, mode)}</p>
      {children}

      <dl className="mt-3 divide-y divide-line border-y border-line">
        <Fact label={t('map.panel.site')}>{siteLabel(td, device.site)}</Fact>
        {zone && <Fact label={t('map.panel.room')}>{zoneLabel(td, zone)}</Fact>}
        {device.vlan !== undefined && (
          <Fact label={t('map.panel.vlan')}>
            <VlanBadge id={device.vlan} />
          </Fact>
        )}
        {(device.ip || device.dhcp) && (
          <Fact label={t('map.panel.address')}>
            {device.ip ? <span className="font-mono">{device.ip}</span> : t('map.panel.dhcp', { subnet: subnet ?? '' })}
          </Fact>
        )}
        {technical && device.model && <Fact label={t('map.panel.model')}>{device.model}</Fact>}
        {technical && device.runsOn && INDEX.devices.get(device.runsOn) && (
          <Fact label={t('map.panel.runsOn')}>
            <DeviceLink d={INDEX.devices.get(device.runsOn)!} />
          </Fact>
        )}
        {technical && device.power && (
          <Fact label={t('map.panel.power')}>
            {device.power.map((id, i) => {
              const src = INDEX.devices.get(id);
              return src ? (
                <span key={id}>
                  {i > 0 && ', '}
                  <DeviceLink d={src} />
                </span>
              ) : null;
            })}
          </Fact>
        )}
        {peers.length > 0 && (
          <Fact label={t('map.panel.group')}>
            {t(device.groupMode === 'active-passive' ? 'map.panel.activePassive' : 'map.panel.activeActive', { peers: peers.map((p) => p.name).join(', ') })}
          </Fact>
        )}
      </dl>

      {device.noteKey && (
        <Section title={t('map.panel.note')}>
          <p className="rounded-xl bg-accent-soft p-3 text-sm leading-relaxed text-ink">{td(device.noteKey)}</p>
        </Section>
      )}

      {needs.length > 0 && (
        <Section title={t('map.panel.needs')}>
          <ul className="space-y-1.5 text-sm">
            {needs.map((s) => {
              const providers = INDEX.providersOf(s, device.site);
              return (
                <li key={s}>
                  <span className="text-ink">{serviceLabel(td, s)}</span>
                  {providers.length > 0 && <span className="text-muted"> · {t('map.panel.providedBy', { devices: providers.map(name).join(', ') })}</span>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {provided.length > 0 && (
        <Section title={t('map.panel.provides')}>
          <ul className="flex flex-wrap gap-1.5">
            {provided.map((s) => (
              <li key={s.id} className="rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-ink">
                {serviceLabel(td, s.id)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('map.panel.dependents')}>
        {dependents.length === 0 ? (
          <p className="text-sm text-muted">{t('map.panel.noDependents')}</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {dependents.slice(0, MAX_DEPENDENTS).map((d) => (
              <li key={d.id}>
                <DeviceLink d={d} />
              </li>
            ))}
            {dependents.length > MAX_DEPENDENTS && <li className="text-muted">{t('map.panel.more', { count: dependents.length - MAX_DEPENDENTS })}</li>}
          </ul>
        )}
      </Section>

      {technical && (
        <Section title={t('map.panel.connections')}>
          <ul className="space-y-1.5 text-sm">
            {INDEX.neighbors(device.id).map((n) => (
              <li key={n.link.id} className="flex flex-wrap items-baseline gap-x-1.5">
                <DeviceLink d={n.device} />
                <span className="text-xs text-muted">
                  {[
                    t(`map.legend.${n.link.kind}`),
                    n.port && t('map.panel.port', { port: n.port }),
                    n.link.speed,
                    n.link.role && t(`map.panel.${n.link.role}`),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
