/**
 * Segmented control (one of N). Used for Simple/Technical and the language switcher.
 * The control is 44 px high (touch target).
 */
import { cn } from '../../utils/cn';

interface Option<T extends string> {
  value: T;
  label: string;
  /** Tooltip */
  title?: string;
  /** Accessible name, if the visible label is an abbreviation ("DE" → "Deutsch") */
  name?: string;
}

interface Props<T extends string> {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({ label, options, value, onChange, className }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex shrink-0 rounded-xl bg-raised p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.name}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-10 min-w-10 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium transition-colors',
              active ? 'bg-surface text-primary-strong shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
