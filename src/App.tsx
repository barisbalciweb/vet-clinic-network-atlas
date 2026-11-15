/**
 * App root: providers → header → the page of the current hash route → footer.
 * Routes: "#/" map (home), "#/simulator", ..., "#/about". Unknown routes show the map.
 */
import { Suspense, lazy, useEffect, useRef, type ComponentType } from 'react';
import { ORG_NAME } from './config';
import { PrefsProvider } from './context/PrefsContext';
import { SimProvider } from './context/SimContext';
import { OpeningProvider } from './context/OpeningContext';
import { I18nProvider, useT } from './i18n/I18nContext';
import { useHashRoute } from './hooks/useHashRoute';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { ABOUT_PATH, moduleForPath } from './modules/registry';
import { PageFallback } from './components/layout/PageFallback';

// Every page is its own chunk: the map (React Flow) is only loaded where it is needed
const page = <M, K extends keyof M>(load: () => Promise<M>, name: K) => lazy(async () => ({ default: (await load())[name] as ComponentType<M[K] extends ComponentType<infer P> ? P : never> }));
const MapPage = page(() => import('./modules/a-map/MapPage'), 'MapPage');
const HaLabPage = page(() => import('./modules/f-ha-lab/HaLabPage'), 'HaLabPage');
const IssuesPage = page(() => import('./modules/c-issues/IssuesPage'), 'IssuesPage');
const OpeningPage = page(() => import('./modules/d-opening/OpeningPage'), 'OpeningPage');
const StandardsPage = page(() => import('./modules/e-standards/StandardsPage'), 'StandardsPage');
const PrivacyPage = page(() => import('./modules/g-privacy/PrivacyPage'), 'PrivacyPage');
const MonitoringPage = page(() => import('./modules/h-monitoring/MonitoringPage'), 'MonitoringPage');
const AboutPage = page(() => import('./modules/about/AboutPage'), 'AboutPage');

export default function App() {
  return (
    <I18nProvider>
      <PrefsProvider>
        <OpeningProvider>
          <SimProvider>
            <Shell />
          </SimProvider>
        </OpeningProvider>
      </PrefsProvider>
    </I18nProvider>
  );
}

function Shell() {
  const t = useT();
  const route = useHashRoute();
  const path = route.path;
  const isAbout = path === ABOUT_PATH;
  const module = moduleForPath(path);
  const pageTitle = isAbout ? t('ui.about.title') : t(`ui.modules.${module.id}.title`);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = `${pageTitle} · ${ORG_NAME}`;
  }, [pageTitle]);

  // A new page starts at the top
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [path]);

  return (
    <div className="flex h-full flex-col">
      <a
        href="#main"
        onClick={(e) => {
          // "#main" would be read as a route; move the focus by hand instead
          e.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-on-primary"
      >
        {t('ui.app.skip')}
      </a>
      <Header path={path} />
      <main id="main" ref={mainRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
        <Suspense fallback={<PageFallback />}>
          {isAbout ? <AboutPage /> : module.id === 'simulator' ? <MapPage route={route} simulator /> : module.id === 'haLab' ? <HaLabPage /> : module.id === 'issues' ? <IssuesPage /> : module.id === 'opening' ? <OpeningPage /> : module.id === 'standards' ? <StandardsPage /> : module.id === 'privacy' ? <PrivacyPage /> : module.id === 'monitoring' ? <MonitoringPage /> : <MapPage route={route} />}
        </Suspense>
      </main>
      {/* On phones the map needs the space; the fictional-environment note is also on the About page */}
      <div className={!isAbout && (module.id === 'map' || module.id === 'simulator') ? 'hidden sm:block' : undefined}>
        <Footer />
      </div>
    </div>
  );
}
