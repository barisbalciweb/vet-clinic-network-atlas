/**
 * "Networks & rules": the VLAN plan and the matrix "who may reach whom", both derived from
 * topology.vlans and topology.accessPolicy. Status is always icon + word, never colour alone.
 * Selecting a cell shows the rule behind it.
 */
import { useState } from 'react';
import { CheckCircle2, CircleDot, Minus, XCircle, type LucideIcon } from 'lucide-react';
import { TOPOLOGY } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import { evaluateAccess, type AccessStatus, type AccessTarget } from '../../utils/access';
import { subnetPattern } from '../../utils/ip';
import { VlanBadge } from '../../components/common/VlanBadge';
import { vlanLabel } from '../../components/map/labels';
import { cn } from '../../utils/cn';

const STATUS: Record<AccessStatus, { icon: LucideIcon; cell: string }> = {
  allowed: { icon: CheckCircle2, cell: 'bg-ok-soft text-ok' },
  limited: { icon: CircleDot, cell: 'bg-warn-soft text-warn' },
  denied: { icon: XCircle, cell: 'bg-bad-soft text-bad' },
  same: { icon: Minus, cell: 'bg-raised text-muted' },
};

export function NetworksView() {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const technical = mode === 'technical';
  const [picked, setPicked] = useState<{ from: number; to: AccessTarget } | null>(null);

  const clinicVlans = TOPOLOGY.vlans.filter((v) => v.scope === 'all');
  const targets: AccessTarget[] = [...clinicVlans.map((v) => v.id), 'hq-servers', 'internet'];
  const targetName = (target: AccessTarget) =>
    target === 'internet' ? t('map.rules.target.internet') : target === 'hq-servers' ? t('map.rules.target.hq') : technical ? `VLAN ${target}` : vlanLabel(td, target);
  const pickedResult = picked ? evaluateAccess(TOPOLOGY.accessPolicy, picked.from, picked.to) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <p className="max-w-prose text-sm leading-relaxed text-muted">{t(`map.rules.intro.${mode}`)}</p>

      <h2 className="mt-6 text-base font-semibold text-ink">{t('map.rules.vlansTitle')}</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2.5 font-semibold">{t('map.rules.col.network')}</th>
              {technical && <th className="px-3 py-2.5 font-semibold">{t('map.rules.col.subnet')}</th>}
              {technical && <th className="px-3 py-2.5 font-semibold">{t('map.rules.col.dhcp')}</th>}
              <th className="px-3 py-2.5 font-semibold">{t('map.rules.col.internet')}</th>
              <th className="px-3 py-2.5 font-semibold">{t('map.rules.col.purpose')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {TOPOLOGY.vlans.map((v) => (
              <tr key={v.id}>
                <td className="px-3 py-2.5 font-medium text-ink">
                  <VlanBadge id={v.id} />
                  {v.scope === 'hq' && <span className="ml-2 rounded-full bg-raised px-2 py-0.5 text-[11px] font-normal text-muted">{t('map.rules.hqOnly')}</span>}
                </td>
                {technical && <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-ink">{v.scope === 'hq' ? `10.0.${v.id}.0/24` : subnetPattern(v.id, t('map.rules.sitePlaceholder'))}</td>}
                {technical && <td className="px-3 py-2.5 text-ink">{v.dhcp ? t('map.rules.yes') : t('map.rules.no')}</td>}
                <td className="px-3 py-2.5 text-ink">{t(`map.rules.internet.${v.internet}`)}</td>
                <td className="px-3 py-2.5 text-muted">{td(`topology.vlan.${v.id}.purpose`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-base font-semibold text-ink">{t('map.rules.matrixTitle')}</h2>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {(['allowed', 'limited', 'denied'] as const).map((s) => {
          const Icon = STATUS[s].icon;
          return (
            <li key={s} className="inline-flex items-center gap-1.5">
              <Icon className={cn('h-4 w-4', STATUS[s].cell.split(' ')[1])} aria-hidden="true" />
              {t(`map.rules.status.${s}`)}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[640px] border-separate border-spacing-1 p-1 text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-muted">{t('map.rules.corner')}</th>
              {targets.map((target) => (
                <th key={target} scope="col" className="px-1 py-1.5 text-center text-xs font-semibold text-ink">
                  {targetName(target)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clinicVlans.map((from) => (
              <tr key={from.id}>
                <th scope="row" className="whitespace-nowrap px-2 py-1 text-left text-xs font-semibold text-ink">
                  <VlanBadge id={from.id} />
                </th>
                {targets.map((to) => {
                  const result = evaluateAccess(TOPOLOGY.accessPolicy, from.id, to);
                  const meta = STATUS[result.status];
                  const isPicked = picked?.from === from.id && picked.to === to;
                  return (
                    <td key={to} className="p-0">
                      <button
                        type="button"
                        onClick={() => setPicked({ from: from.id, to })}
                        aria-pressed={isPicked}
                        aria-label={`${vlanLabel(td, from.id)} → ${targetName(to)}: ${t(`map.rules.status.${result.status}`)}`}
                        title={t(`map.rules.status.${result.status}`)}
                        className={cn('flex h-11 w-full min-w-11 items-center justify-center rounded-lg', meta.cell, isPicked && 'ring-2 ring-primary')}
                      >
                        <meta.icon className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 min-h-24 rounded-2xl border border-line bg-surface p-4 text-sm" aria-live="polite">
        {!picked || !pickedResult ? (
          <p className="text-muted">{t('map.rules.pick')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 font-semibold text-ink">
              {t('map.rules.detail', { from: vlanLabel(td, picked.from), to: typeof picked.to === 'number' ? vlanLabel(td, picked.to) : targetName(picked.to) })}
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs', STATUS[pickedResult.status].cell)}>{t(`map.rules.status.${pickedResult.status}`)}</span>
            </div>
            <ul className="mt-2 space-y-1 leading-relaxed text-ink">
              {pickedResult.status === 'same' && <li>{t('map.rules.sameNote')}</li>}
              {pickedResult.reasonKeys.map((k) => (
                <li key={k}>{td(k)}</li>
              ))}
              {pickedResult.status !== 'same' && pickedResult.reasonKeys.length === 0 && <li>{t('map.rules.defaultDeny')}</li>}
            </ul>
            {pickedResult.serviceKeys.length > 0 && (
              <p className="mt-2 text-muted">
                {t('map.rules.onlyServices')} {pickedResult.serviceKeys.map((k) => td(k)).join(', ')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
