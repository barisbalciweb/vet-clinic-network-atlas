/**
 * A network (VLAN) as a small badge: colour square + name. The colour is only a visual aid;
 * the name (Simple) or number and name (Technical) is always written out.
 */
import { INDEX } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useI18n } from '../../i18n/I18nContext';
import { vlanLabel } from '../map/labels';

export function VlanBadge({ id }: { id: number }) {
  const { td } = useI18n();
  const { mode } = usePrefs();
  const vlan = INDEX.vlans.get(id);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: vlan?.color }} aria-hidden="true" />
      {mode === 'technical' ? `VLAN ${id} · ${vlan?.name ?? ''}` : vlanLabel(td, id)}
    </span>
  );
}
