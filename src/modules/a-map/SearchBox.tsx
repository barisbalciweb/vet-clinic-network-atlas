/**
 * Device search: by what it is (in the current language), hostname, IP, room or site.
 * Arrow keys move through the results, Enter opens the device on the map, Esc closes the list.
 */
import { useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { INDEX } from '../../data';
import { useI18n } from '../../i18n/I18nContext';
import type { Device } from '../../schema/topology.schema';
import { RoleIcon } from '../../components/map/RoleIcon';
import { roleLabel, siteLabel, zoneLabel } from '../../components/map/labels';
import { cn } from '../../utils/cn';

const MAX_RESULTS = 8;
const fold = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function SearchBox({ onPick }: { onPick: (device: Device) => void }) {
  const { t, td, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // One searchable line per device, rebuilt when the language changes
  const haystack = useMemo(
    () =>
      INDEX.topology.devices.map((d) => {
        const zone = INDEX.zones.get(d.zone);
        const where = `${siteLabel(td, d.site)}${zone ? ` · ${zoneLabel(td, zone)}` : ''}`;
        return { device: d, where, text: fold([d.name, roleLabel(td, d.role), d.ip ?? '', where].join(' ')) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang],
  );

  const results = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return haystack.filter((h) => words.every((w) => h.text.includes(w))).slice(0, MAX_RESULTS);
  }, [query, haystack]);

  const pick = (d: Device) => {
    onPick(d);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const showList = open && query.trim() !== '';

  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls="device-search-results"
        aria-label={t('map.search.label')}
        placeholder={t('map.search.placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            pick(results[active].device);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-10 text-sm text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          aria-label={t('map.search.clear')}
          onClick={() => {
            setQuery('');
            inputRef.current?.focus();
          }}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {showList && (
        <ul id="device-search-results" role="listbox" className="absolute inset-x-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">{t('map.search.noResults')}</li>}
          {results.map(({ device, where }, i) => (
            <li key={device.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                // onMouseDown: runs before the input loses focus
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(device)}
                onMouseEnter={() => setActive(i)}
                className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left', i === active && 'bg-primary-soft')}
              >
                <RoleIcon icon={INDEX.roles.get(device.role)?.icon} className="h-5 w-5 shrink-0 text-primary-strong" />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-medium text-ink">
                    {roleLabel(td, device.role)} <span className="font-mono text-xs font-normal text-muted">{device.name}</span>
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {where}
                    {device.ip && ` · ${device.ip}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
