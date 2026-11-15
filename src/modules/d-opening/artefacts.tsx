/**
 * The example artefact of each opening phase. Lists come from the translation files; the IP plan
 * and the port plan are computed from the topology. The hardware phase has the procurement
 * simulation (ProcurementWizard), which builds the bill of materials from catalog.json.
 */
import type { ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { CATALOG, INDEX, PLAYBOOK, TOPOLOGY } from '../../data';
import { useI18n } from '../../i18n/I18nContext';
import { ipPlan, portPlan, type CatalogItem, type Phase } from '../../schema/playbook';
import { roleLabel } from '../../components/map/labels';
import { VlanBadge } from '../../components/common/VlanBadge';
import { cn } from '../../utils/cn';

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-accent bg-accent-soft/40 p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const th = 'px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted';
const td_ = 'px-2 py-1.5 align-top';

export function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const { t } = useI18n();
  const btn = 'flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-ink hover:bg-raised disabled:opacity-40';
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-ink" id={`lbl-${label}`}>
        {label}
      </span>
      <div className="flex items-center gap-1.5" role="group" aria-labelledby={`lbl-${label}`}>
        <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={t('opening.bom.less', { what: label })}>
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <output className="w-8 text-center text-base font-semibold text-ink" aria-live="polite">
          {value}
        </output>
        <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={t('opening.bom.more', { what: label })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function useCatalogNames() {
  const { t, td } = useI18n();
  const name = (item: CatalogItem) => (item.labelKey ? td(item.labelKey) : roleLabel(td, item.role ?? ''));
  /** "1 base + 0.5 per treatment room" */
  const rule = (item: CatalogItem) => {
    const r = item.rule;
    const parts: string[] = [];
    if (r.fixed) parts.push(t('opening.rule.fixed', { n: r.fixed }));
    if (r.perRoom) parts.push(t('opening.rule.perRoom', { n: r.perRoom }));
    if (r.perDesk) parts.push(t('opening.rule.perDesk', { n: r.perDesk }));
    for (const [f, n] of Object.entries(r.perFeature ?? {})) parts.push(t('opening.rule.perFeature', { n, feature: td(`opening.bom.${f}`) }));
    if (r.perPorts) parts.push(t('opening.rule.perPorts', { n: r.perPorts }));
    if (r.minPerAreaM2) parts.push(t('opening.rule.minPerArea', { n: r.minPerAreaM2 }));
    if (r.per) parts.push(t('opening.rule.per', { items: r.per.map((s) => name(CATALOG.items.find((i) => i.sku === s)!)).join(', ') }));
    return parts.join(' + ');
  };
  return { name, rule };
}

function IpPlan() {
  const { t } = useI18n();
  const plan = ipPlan(TOPOLOGY, PLAYBOOK.site, PLAYBOOK.dhcpPool);
  return (
    <Frame title={t('opening.plan.ipTitle')}>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>{t('opening.plan.vlan')}</th>
              <th className={th}>{t('opening.plan.subnet')}</th>
              <th className={th}>{t('opening.plan.gateway')}</th>
              <th className={th}>{t('opening.plan.dhcp')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono text-xs text-ink">
            {plan.vlans.map((v) => (
              <tr key={v.vlan}>
                <td className={cn(td_, 'font-sans text-sm')}>
                  <VlanBadge id={v.vlan} />
                </td>
                <td className={td_}>{v.subnet}</td>
                <td className={td_}>{v.gateway}</td>
                <td className={cn(td_, !v.dhcp && 'font-sans text-muted')}>{v.dhcp ?? t('opening.plan.static')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{t('opening.plan.staticTitle')}</h4>
      <ul className="mt-1 grid gap-x-4 gap-y-0.5 font-mono text-xs text-ink sm:grid-cols-2">
        {plan.statics.map((s) => (
          <li key={s.device} className="flex justify-between gap-2 border-b border-line py-1">
            <span>{INDEX.devices.get(s.device)?.name}</span>
            <span>{s.ip}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function PortPlan() {
  const { t, td } = useI18n();
  const rows = portPlan(INDEX, PLAYBOOK.site);
  return (
    <Frame title={t('opening.plan.portTitle')}>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>{t('opening.plan.port')}</th>
              <th className={th}>{t('opening.plan.device')}</th>
              <th className={th}>{t('opening.plan.vlan')}</th>
              <th className={th}>{t('opening.plan.poe')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-ink">
            {rows.map((r) => {
              const d = INDEX.devices.get(r.device)!;
              return (
                <tr key={`${r.switch}-${r.port}`}>
                  <td className={cn(td_, 'font-mono text-xs')}>
                    {INDEX.devices.get(r.switch)?.name} / {r.port}
                  </td>
                  <td className={td_}>
                    <span className="font-mono text-xs">{d.name}</span>
                    <span className="block text-xs text-muted">{roleLabel(td, d.role)}</span>
                  </td>
                  <td className={cn(td_, 'text-xs')}>{r.trunk ? `${t('opening.plan.trunk')} ${r.vlans.join(', ')}` : r.vlans.join(', ')}</td>
                  <td className={cn(td_, 'text-xs')}>{r.poe ? t('opening.plan.yes') : t('opening.plan.no')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

export function Artefact({ phase }: { phase: Phase }) {
  const { t, td } = useI18n();
  const a = phase.artefact;
  if (a.type === 'procurement') return <Frame title={t('shop.ui.title')}><p className="text-sm text-ink">{t('shop.ui.below')}</p></Frame>;
  if (a.type === 'ip-plan') return <IpPlan />;
  if (a.type === 'port-plan') return <PortPlan />;
  return (
    <Frame title={td(`opening.artefact.${a.id}.title`)}>
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink">
        {Array.from({ length: a.items }, (_, i) => (
          <li key={i}>{td(`opening.artefact.${a.id}.item.${i + 1}`)}</li>
        ))}
      </ol>
    </Frame>
  );
}
