/**
 * "Break it": the fault actions for one device and for each of its connections.
 * Selecting an active action again removes the fault.
 */
import { Check, Zap } from 'lucide-react';
import { FAULTS, INDEX } from '../../data';
import { useSim } from '../../context/SimContext';
import { useOpening } from '../../context/OpeningContext';
import { useI18n } from '../../i18n/I18nContext';
import { actionsFor } from '../../engine/explain';
import type { Device } from '../../schema/topology.schema';
import { cn } from '../../utils/cn';
import { useSimText } from './useSimText';

function ActionButton({ action, target, onApplied }: { action: string; target: string; onApplied: () => void }) {
  const { t, td } = useI18n();
  const sim = useSim();
  const active = sim.isActive(action, target);
  return (
    <button
      type="button"
      aria-pressed={active}
      title={active ? t('sim.undo') : undefined}
      onClick={() => sim.toggle(action, target) && onApplied()}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium',
        active ? 'border-bad bg-bad text-white' : 'border-line bg-surface text-ink hover:border-bad hover:bg-bad-soft',
      )}
    >
      {active && <Check className="h-4 w-4" aria-hidden="true" />}
      {td(`faults.action.${action}.label`)}
    </button>
  );
}

export function BreakActions({ device, onApplied }: { device: Device; onApplied: () => void }) {
  const { t } = useI18n();
  const { device: name } = useSimText();
  const { siteStatus } = useOpening();
  const planned = (id: string) => siteStatus(id) === 'planned';

  if (planned(device.site)) return <p className="mt-4 rounded-xl bg-accent-soft p-3 text-sm text-ink">{t('sim.plannedSite')}</p>;

  const own = actionsFor(FAULTS, INDEX, device.id);
  const links = INDEX.neighbors(device.id)
    .filter((n) => !planned(n.device.site))
    .map((n) => ({ n, actions: actionsFor(FAULTS, INDEX, n.link.id) }))
    .filter((x) => x.actions.length > 0);

  return (
    <section className="mt-4 rounded-xl border border-bad/40 bg-bad-soft/40 p-3" aria-label={t('sim.break')}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Zap className="h-4 w-4 text-bad" aria-hidden="true" />
        {t('sim.break')}
      </h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {own.map((a) => (
          <ActionButton key={a.id} action={a.id} target={device.id} onApplied={onApplied} />
        ))}
      </div>
      {links.length > 0 && (
        <>
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">{t('sim.breakLinks')}</h4>
          <ul className="mt-1 divide-y divide-line">
            {links.map(({ n, actions }) => (
              <li key={n.link.id} className="py-2">
                <div className="text-sm text-ink">
                  {name(n.device.id)}
                  <span className="text-muted">
                    {' · '}
                    {t(`map.legend.${n.link.kind}`)}
                    {n.link.role === 'backup' && ` · ${t('map.panel.backup')}`}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <ActionButton key={a.id} action={a.id} target={n.link.id} onApplied={onApplied} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
