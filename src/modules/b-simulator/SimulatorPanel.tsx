/**
 * The side of the failure simulator: the result, or – while a device is selected – that device
 * with its fault actions. A column on the right on desktop; a bottom sheet on phones that shows
 * only the outcome until it is opened.
 */
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { useSim } from '../../context/SimContext';
import { useI18n } from '../../i18n/I18nContext';
import type { Device } from '../../schema/topology.schema';
import { DeviceDetails } from '../../components/panels/DeviceDetails';
import { cn } from '../../utils/cn';
import { BreakActions } from './BreakActions';
import { OUTCOME, ResultPanel } from './ResultPanel';

interface Props {
  selected: Device | undefined;
  onSelect: (id: string) => void;
  onBack: () => void;
  onScenario: (site: string | undefined) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

export function SimulatorPanel({ selected, onSelect, onBack, onScenario, open, setOpen }: Props) {
  const { t, td } = useI18n();
  const sim = useSim();
  const outcome = OUTCOME[sim.explanation.outcome];
  const expanded = open || !!selected;

  return (
    <aside
      aria-label={t('sim.result')}
      className={cn(
        'z-30 flex flex-col overflow-hidden border-line bg-surface',
        // phone: bottom sheet over the map
        'absolute inset-x-0 bottom-0 rounded-t-2xl border-t shadow-2xl',
        expanded ? 'max-h-[72%]' : 'max-h-16',
        // desktop: fixed column
        'md:static md:max-h-none md:w-[400px] md:shrink-0 md:rounded-none md:border-l md:border-t-0 md:shadow-none',
      )}
    >
      {/* Phone only: the handle with the outcome */}
      {!selected && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-h-16 w-full shrink-0 items-center gap-2.5 px-4 text-left md:hidden"
        >
          <outcome.icon className={cn('h-5 w-5 shrink-0', outcome.tone.split(' ').find((c) => c.startsWith('text-')))} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{td(`faults.outcome.${sim.explanation.outcome}`)}</span>
          <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary-strong">
            {open ? t('sim.hideResult') : t('sim.showResult')}
            {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronUp className="h-4 w-4" aria-hidden="true" />}
          </span>
        </button>
      )}

      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-4', !expanded && 'hidden md:block', !selected && 'pt-0 md:pt-4')}>
        {selected ? (
          <>
            <button type="button" onClick={onBack} className="-ml-2 mb-2 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary-strong hover:bg-raised">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t('sim.backToResult')}
            </button>
            <DeviceDetails key={selected.id} device={selected} onSelect={onSelect}>
              <BreakActions device={selected} onApplied={onBack} />
            </DeviceDetails>
          </>
        ) : (
          <ResultPanel onScenario={onScenario} />
        )}
      </div>
    </aside>
  );
}
