# Reuse analysis: `school-network-map` → Vet Clinic Network Atlas

Phase 0 result. Source read: `github.com/barisbalciweb/school-network-map` at commit `60f4d1d`
(about 11,800 lines, 80 files).

## 1. What the old app is

A single-screen topology viewer: one JSON file → zod validation → index → elkjs layout → one React Flow
canvas, with a details panel, search, filters, a VLAN matrix, a glossary and PNG/PDF export.

| Area | How the old app does it |
|---|---|
| Stack | React 18, TypeScript 5.6 (strict), Vite 6, `@xyflow/react` 12, elkjs 0.9, Tailwind 4 (`@tailwindcss/vite`), zod 3 |
| Extra deps | `lucide-react` (icons), `html-to-image`, `jspdf`, `jspdf-autotable` (export), `tsx` (scripts) |
| Navigation | No router. A `view` state (`topology` / `tables` / `glossary`) in `AppContext` |
| State | One `AppContext`: mode, selection, hover, filters, path, derived "emphasis" (what is dimmed) |
| Data | `src/data/topology.json` with free text in English; areas nested by `parent` |
| Validation | Two stages in `src/schema/validate.ts`: zod shape, then cross-references. Errors block, warnings inform. Same code runs in the browser and in `scripts/validate-data.ts` |
| i18n, UI | Typed TS dictionaries `en.ts` / `de.ts` / `tr.ts`; `Dict` type forces the same keys; values may be functions |
| i18n, data | Overlay files `topology.de.json` / `topology.tr.json` merged over the English data; missing texts silently stay English |
| Layout | Custom nested layout on top of elkjs (`utils/layout.ts`, 629 lines), loaded as a lazy chunk |
| Map | Devices not draggable, center handles, straight edges, parallel-link offset, custom wheel/double-tap zoom, minimap on desktop |
| Mobile | Details as bottom sheet below `md`, tap shows tooltip first, 2-finger pinch through React Flow |
| Theme | `<html class="dark">` + Tailwind `dark:` variant, CSS variables for link colours, OS preference as default |
| Storage | `readStorage` / `writeStorage` with try/catch and a key prefix |
| Deploy | GitHub Actions: `npm ci` → `validate-data` → build with `BASE_PATH=/<repo>/` → Pages |
| Quality | Type-check only. **No tests, no linter** |

## 2. Reuse as is (copy, rename, adjust imports)

| File(s) | Why |
|---|---|
| `.github/workflows/deploy.yml` | Works for sub-path Pages. Add `lint` and `test` steps |
| `vite.config.ts` (`base` from `BASE_PATH`), `tsconfig.json` | Same build setup |
| `hooks/useLocalStorage.ts`, `useTheme.ts`, `useMediaQuery.ts` | Exactly the "light preferences in localStorage with try/catch" rule. New key prefix |
| `hooks/useMapZoom.ts`, `utils/pointer.ts` | Wheel, pinch and double-tap behaviour already tuned for phones |
| `utils/ip.ts`, `utils/cn.ts`, `utils/text.ts` | Generic helpers |
| `utils/graph.ts` (BFS, adjacency) | Base for path highlighting; the simulation engine gets its own reachability on top |
| `utils/access.ts` (`evaluateAccess`) | First-match ACL evaluation for the VLAN matrix |
| `schema/errorMap.ts`, `formatPath`, `parseJsonWithLocation` | Readable validation messages |
| Code style | File header comment explaining intent, `memo` nodes, refs for stable React Flow callbacks, status as icon + word + colour |

## 3. Adapt

| Old | New | Reason |
|---|---|---|
| `view` state with 3 views | Hash routes `#/map`, `#/simulator`, … for modules A–H + About | Eight modules need deep links; hash routing works on Pages without a 404 trick. Written by hand (about 40 lines), no router dependency |
| One `AppContext` | `PrefsContext` (lang, theme, mode, pet toggle) + `MapContext` (selection, hover, focus) + `SimContext` (active faults, result) | Faults must be visible from the map, the issue catalogue and the status board |
| `topology.schema.ts` | New schema, see `docs/SCHEMA.md`. Keeps `idSchema`, VLAN, IP and access-rule primitives | Multi-site, roles, power and service dependencies, clinic template |
| `areas` (building/floor/room) | `sites` + `zones` | Drill-down is site → zone → device |
| Single canvas, focus by zooming | Two levels: overview canvas (sites + tunnels on a Germany schematic) and one canvas per site | The old app has no real drill-down, only nested boxes. Four sites in one canvas would be unreadable on a phone |
| `utils/layout.ts` | Overview uses fixed positions from data. Site canvas uses a small deterministic row/grid layout driven by `row` and `cols` in the data; **elkjs is not used** | Predictable picture, about 1.4 MB less to download, 200 lines instead of 629 |
| `LinkEdge.tsx` | `PetEdge`: same path and parallel-offset logic, plus state styling and animal sprites | Module A "pet traffic" |
| `DeviceNode.tsx`, `DeviceIcon.tsx` | Same box, new device roles (card terminal, X-ray, analyzer, UPS, …) and a state badge | Simulator needs up / degraded / down on the node |
| `SidePanel`, `HoverTooltip`, `SearchBox` | Kept, restyled, texts from keys; the panel gains fault actions | Brief asks for the same interactions |
| `AccessMatrix` | Kept; targets extended from "VLAN / internet" to named zones (`hq-servers`, `payment`, `vendor-support`) | POS and Medical rules cannot be expressed as VLAN → VLAN only |
| `validate.ts` | Same two-stage pattern, extended to all data files, translation-key check and text-length check | Brief section 7 |
| `index.css` | Same structure, new tokens: warm off-white, teal primary, apricot accent, separate status colours | Brief section 6 |
| `Header.tsx` | Same controls; module navigation collapses to a menu below `md` | Eight entries do not fit a tab row |
| `README.md` / `README.de.md` | Same short format | Phase 10 |

## 4. Drop

| Old | Reason |
|---|---|
| School content: areas, VLANs, devices, Active Directory tab, OU/GPO data, smart boards | School-specific; not copied |
| PNG/PDF export, `PdfWriter`, embedded fonts, `html-to-image`, `jspdf*` | Out of scope ("only if export is added later") |
| Data overlays (`topology.<lang>.json`, `localizeData.ts`) | Replaced by translation keys. Overlays let missing translations pass silently, which the brief forbids |
| Typed TS dictionaries with function values | Replaced by JSON + `{param}` placeholders so the validator can check keys across languages and data files |
| Glossary view and `TermHint` | Not requested. The Simple/Technical split covers it |
| Guided tour, auto-hiding dock, filter panel | Not requested; keeps the UI calm. A VLAN highlight stays as part of the legend |
| `vswitch` / port-group modelling inside the map | Module F shows the cluster in its own view at the right level of detail |
| Ctrl+click path between two devices | Replaced by "what depends on this device" in the details panel |

## 5. What is new (nothing to reuse)

- Simulation engine (`src/engine/`), pure TypeScript, with Vitest tests. The old repo has no tests at all.
- Clinic template expansion: one template + per-site variables → devices, links, IPs.
- Pet-traffic edge animation.
- Modules C–H and their data files.
- Lint setup (the old repo has none; the brief asks for a lint step).

## 6. Dependencies

Section 3 of the brief lists React, TypeScript, Vite, React Flow, elkjs, Tailwind, zod. Needed in addition:

| Package | Status | Why |
|---|---|---|
| `vitest` | Named in the brief (Module B) | Engine tests |
| `tsx`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `@types/*` | Tooling of the listed stack, already in the old repo | Build and `validate-data` |
| `lucide-react` | **Needs approval.** Used throughout the old app | UI and status icons. Alternative: hand-drawn SVG icons only |
| `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks` | **Needs approval** (dev only) | The brief requires a lint step after each phase |

No router, no state library, no animation library, no test-DOM library are planned.
