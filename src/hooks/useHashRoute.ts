/**
 * Minimal hash router: "#/simulator?site=hh" → { path: "simulator", params: { site: "hh" } }.
 * Hash routes work on GitHub Pages under a sub-path without any server configuration, and every
 * page – including an opened site or device on the map – gets a shareable link.
 */
import { useEffect, useState } from 'react';

export interface Route {
  path: string;
  params: Record<string, string>;
}

export function parseHash(hash: string): Route {
  const [rawPath, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const params: Record<string, string> = {};
  new URLSearchParams(query).forEach((v, k) => {
    params[k] = v;
  });
  return { path: rawPath.split('/')[0].toLowerCase(), params };
}

/** Empty and undefined params are left out, so links stay short. */
export function hrefFor(path: string, params: Record<string, string | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) query.set(k, v);
  const q = query.toString();
  return `#/${path}${q ? `?${q}` : ''}`;
}

/** replace = true: do not add a browser history entry (e.g. selecting a device on the map). */
export function navigate(path: string, params: Record<string, string | undefined> = {}, replace = false) {
  const href = hrefFor(path, params);
  if (replace) {
    window.history.replaceState(null, '', href);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = href;
  }
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () =>
      setRoute((prev) => {
        const next = parseHash(window.location.hash);
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    window.addEventListener('hashchange', onChange);
    // A child may have changed the hash before this listener existed
    onChange();
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
