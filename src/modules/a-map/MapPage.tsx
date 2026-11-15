/**
 * Module A – the map, and the workspace of Module B – the failure simulator.
 *
 * Drill-down: overview (all sites on the Germany schematic) → one site (rooms and devices) →
 * one device. The current place lives in the URL ("#/?site=hh&device=hh-fw", "#/?view=rules",
 * "#/simulator?site=hh"), so every state can be linked and the browser's back button walks up.
 *
 * Both pages show the same simulated network (SimContext): links, devices and sites carry the
 * state the simulation gives them. The map page shows details of a device; the simulator page
 * shows the result and lets the user break things.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Info, MapPinned, ShieldCheck, X, Zap } from 'lucide-react';
import { INDEX, ISSUES, PRIVACY } from '../../data';
import { privacyByDevice } from '../../schema/compliance';
import { PrivacySection } from '../g-privacy/PrivacySection';
import { highlightFor } from '../../schema/issues';
import { usePrefs } from '../../context/PrefsContext';
import { useSim } from '../../context/SimContext';
import { useOpening } from '../../context/OpeningContext';
import { useI18n } from '../../i18n/I18nContext';
import { hrefFor, navigate, type Route } from '../../hooks/useHashRoute';
import type { Device, LinkKind } from '../../schema/topology.schema';
import { layoutOverview, layoutSite } from '../../utils/layout';
import { cn } from '../../utils/cn';
import { Segmented } from '../../components/common/Segmented';
import { MapCanvas } from '../../components/map/MapCanvas';
import { MapUiContext, type HoverInfo, type MapUi } from '../../components/map/MapUiContext';
import { HoverCard } from '../../components/map/HoverCard';
import { Legend } from '../../components/map/Legend';
import { siteLabel } from '../../components/map/labels';
import { linkStateOf, type LinkState } from '../../components/map/linkState';
import { SidePanel } from '../../components/panels/SidePanel';
import { DeviceDetails } from '../../components/panels/DeviceDetails';
import { SimulatorPanel } from '../b-simulator/SimulatorPanel';
import { SearchBox } from './SearchBox';
import { NetworksView } from './NetworksView';

type View = 'map' | 'rules';
const KIND_ORDER: LinkKind[] = ['lan', 'wifi', 'wan', 'vpn', 'storage', 'virtual'];
const NO_OVERRIDES = { down: new Set<string>(), degraded: new Set<string>() };

export function MapPage({ route, simulator = false }: { route: Route; simulator?: boolean }) {
  const { t, td } = useI18n();
  const { theme } = usePrefs();
  const sim = useSim();
  const { siteStatus } = useOpening();
  const base = simulator ? 'simulator' : '';
  const view: View = !simulator && route.params.view === 'rules' ? 'rules' : 'map';
  const site = INDEX.sites.get(route.params.site ?? '');
  const selected = INDEX.devices.get(route.params.device ?? '');
  // A device link without (or with the wrong) site still opens the right site
  const siteId = selected?.site ?? site?.id ?? null;
  const currentSite = siteId ? INDEX.sites.get(siteId) : undefined;

  // A common issue (Module C) whose devices are highlighted
  const issue = !simulator ? ISSUES.issues.find((i) => i.id === route.params.issue) : undefined;
  const issueId = issue?.id;
  // Data protection layer (Module G): devices with personal data are highlighted
  const privacyOn = !simulator && route.params.privacy === '1';
  const privacyMap = useMemo(() => (privacyOn ? privacyByDevice(PRIVACY, INDEX) : null), [privacyOn]);
  const privacyFlag = privacyOn ? '1' : undefined;
  const highlight = useMemo(() => (privacyMap ? new Set(privacyMap.keys()) : issue ? highlightFor(issue, INDEX) : null), [issue, privacyMap]);

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const layout = useMemo(() => (siteId ? layoutSite(INDEX, siteId) : layoutOverview(INDEX)), [siteId]);
  // Link states come from the simulation (the healthy network while nothing is broken)
  const linkStates = useMemo(() => {
    const states = new Map<string, LinkState>();
    for (const e of layout.edges) {
      const link = INDEX.links.get(e.id);
      if (link) states.set(link.id, sim.result.links[link.id]?.state ?? linkStateOf(INDEX, link, NO_OVERRIDES));
    }
    return states;
  }, [layout, sim.result]);

  const legend = useMemo(() => {
    const kinds = new Set(layout.edges.map((e) => INDEX.links.get(e.id)?.kind));
    return { kinds: KIND_ORDER.filter((k) => kinds.has(k)), states: new Set(linkStates.values()) };
  }, [layout, linkStates]);

  const selectDevice = useCallback(
    (id: string) => {
      const d = INDEX.devices.get(id);
      if (d) navigate(base, { site: d.site, device: d.id, issue: issueId, privacy: privacyFlag }, true);
    },
    [base, issueId, privacyFlag],
  );
  const clearSelection = useCallback(() => navigate(base, { site: siteId ?? undefined, issue: issueId, privacy: privacyFlag }, true), [base, siteId, issueId, privacyFlag]);
  const openSite = useCallback(
    (id: string) => {
      setHover(null);
      navigate(base, { site: id, issue: issueId, privacy: privacyFlag });
    },
    [base, issueId, privacyFlag],
  );

  const ui = useMemo<MapUi>(
    () => ({
      selectedId: selected?.id ?? null,
      planned: !!currentSite && siteStatus(currentSite.id) === 'planned',
      siteStatus,
      selectDevice,
      clearSelection,
      openSite,
      setHover,
      linkState: (id) => linkStates.get(id) ?? 'up',
      deviceState: sim.deviceState,
      siteState: sim.siteState,
      highlight,
      privacyCats: privacyMap ? (id) => [...new Set(privacyMap.get(id)?.flatMap((m) => m.categories) ?? [])] : null,
    }),
    [selected, currentSite, selectDevice, clearSelection, openSite, linkStates, sim.deviceState, sim.siteState, highlight, siteStatus, privacyMap],
  );

  const pickFromSearch = (d: Device) => {
    navigate(base, { site: d.site, device: d.id });
    setFocus({ id: d.id, nonce: Date.now() });
  };

  // A link like #/simulator?scenario=offline loads a ready-made scenario (shareable, used by Module C)
  // ... and #/simulator?issue=label-printer loads the faults of a common issue
  const scenarioParam = simulator ? route.params.scenario : undefined;
  const issueParam = simulator ? route.params.issue : undefined;
  const { loadScenario, loadIssue } = sim;
  useEffect(() => {
    if (!scenarioParam && !issueParam) return;
    const target = scenarioParam ? loadScenario(scenarioParam) : loadIssue(issueParam!);
    setSheetOpen(true);
    navigate(base, { site: target }, true);
  }, [scenarioParam, issueParam, loadScenario, loadIssue, base]);

  const showScenario = (scenarioSite: string | undefined) => {
    setSheetOpen(true);
    if (scenarioSite) navigate(base, { site: scenarioSite });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2 sm:px-4">
        {!simulator && (
          <Segmented<View>
            label={t('map.tabs.label')}
            value={view}
            onChange={(v) => navigate('', v === 'rules' ? { view: 'rules' } : { site: siteId ?? undefined })}
            options={[
              { value: 'map', label: t('map.tabs.map') },
              { value: 'rules', label: t('map.tabs.rules') },
            ]}
          />
        )}
        {view === 'map' && (
          <>
            <nav aria-label={t('map.crumb.label')} className="flex min-w-0 items-center gap-1 text-sm">
              {currentSite ? (
                <>
                  <a href={hrefFor(base)} className="flex min-h-11 items-center rounded-lg px-1.5 font-medium text-primary-strong underline-offset-2 hover:underline">
                    {t('map.crumb.all')}
                  </a>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                  <span aria-current="page" className="truncate font-semibold text-ink">
                    {siteLabel(td, currentSite.id)}
                  </span>
                </>
              ) : (
                <span aria-current="page" className="flex min-h-11 items-center px-1.5 font-semibold text-ink">
                  {t('map.crumb.all')}
                </span>
              )}
            </nav>
            {!simulator && (
              <button
                type="button"
                onClick={() => navigate('', { site: siteId ?? undefined, device: selected?.id, privacy: privacyOn ? undefined : '1' }, true)}
                aria-pressed={privacyOn}
                aria-label={privacyOn ? t('privacy.ui.layerOn') : t('privacy.ui.layerOff')}
                title={privacyOn ? t('privacy.ui.layerOn') : t('privacy.ui.layerOff')}
                className={cn(
                  'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium sm:ml-auto',
                  privacyOn ? 'border-primary bg-primary-soft text-primary-strong' : 'border-line bg-surface text-ink hover:bg-raised',
                )}
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span className="hidden md:inline">{t('privacy.ui.layer')}</span>
              </button>
            )}
            <div className="w-full sm:w-auto sm:min-w-72">
              <SearchBox onPick={pickFromSearch} />
            </div>
          </>
        )}
      </div>

      {!simulator && view === 'map' && sim.active.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warn/40 bg-warn-soft px-3 py-1.5 text-sm text-ink sm:px-4" role="status">
          <Zap className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <span className="font-medium">{t('sim.banner', { count: sim.active.length })}</span>
          <a href={hrefFor('simulator', { site: siteId ?? undefined })} className="flex min-h-11 items-center font-medium text-primary-strong underline-offset-2 hover:underline">
            {t('sim.bannerOpen')}
          </a>
          <button type="button" onClick={sim.reset} className="min-h-11 rounded-lg px-2 font-medium text-primary-strong hover:bg-surface">
            {t('sim.reset')}
          </button>
        </div>
      )}

      {privacyOn && view === 'map' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-primary/40 bg-primary-soft px-3 py-1.5 text-sm text-ink sm:px-4" role="status">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary-strong" aria-hidden="true" />
          <span className="min-w-0">{t('privacy.ui.layerBanner')}</span>
        </div>
      )}

      {issue && !privacyOn && view === 'map' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-primary/40 bg-primary-soft px-3 py-1.5 text-sm text-ink sm:px-4" role="status">
          <MapPinned className="h-4 w-4 shrink-0 text-primary-strong" aria-hidden="true" />
          <span className="min-w-0 font-medium">{t('issues.ui.banner', { symptom: td(`issues.item.${issue.id}.symptom`) })}</span>
          <a
            href={hrefFor('', { site: siteId ?? undefined, device: selected?.id })}
            className="inline-flex min-h-11 items-center gap-1 font-medium text-primary-strong underline-offset-2 hover:underline"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            {t('issues.ui.clearHighlight')}
          </a>
        </div>
      )}

      {view === 'rules' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NetworksView />
        </div>
      ) : (
        <MapUiContext.Provider value={ui}>
          <div data-tour="map" className={cn('relative flex min-h-0 flex-1', simulator && 'with-sheet')}>
            <div className="relative min-h-0 min-w-0 flex-1">
              {/* key: a new site is a new canvas, fitted to the screen */}
              <MapCanvas
                key={siteId ?? 'overview'}
                layout={layout}
                colorMode={theme}
                focus={focus}
                label={currentSite ? t('map.canvas.site', { site: siteLabel(td, currentSite.id) }) : t('map.canvas.overview')}
              />
              {currentSite && siteStatus(currentSite.id) === 'planned' && (
                <p className="absolute left-1/2 top-3 z-10 flex w-[min(92%,34rem)] -translate-x-1/2 items-start gap-2 rounded-xl border border-accent bg-accent-soft px-3 py-2 text-sm text-ink shadow-sm">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden="true" />
                  {t('map.site.plannedBanner')}
                </p>
              )}
              <Legend kinds={legend.kinds} states={legend.states} deviceStates={sim.active.length > 0} raised={simulator} />
              {!simulator && selected && (
                <SidePanel label={t('map.panel.label')} closeLabel={t('map.panel.close')} onClose={clearSelection}>
                  <DeviceDetails key={selected.id} device={selected} onSelect={selectDevice}>
                    {privacyMap?.get(selected.id) && <PrivacySection measures={privacyMap.get(selected.id)!} />}
                  </DeviceDetails>
                </SidePanel>
              )}
            </div>
            {simulator && (
              <SimulatorPanel selected={selected} onSelect={selectDevice} onBack={clearSelection} onScenario={showScenario} open={sheetOpen} setOpen={setSheetOpen} />
            )}
          </div>
          <HoverCard info={hover} />
        </MapUiContext.Provider>
      )}
    </div>
  );
}
