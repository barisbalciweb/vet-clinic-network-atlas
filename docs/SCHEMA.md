# Data schema (proposal, Phase 0)

All content of the app lives in JSON files under `src/data/`, validated with zod
(`src/schema/*.schema.ts`) and checked by `npm run validate-data`. Components never contain content.

Status: **proposal**. Field names are final unless changed in review; the zod files are written in the
phase that first needs them.

## 1. Conventions

- **Ids**: `[A-Za-z0-9._-]+`, unique per list. Device ids start with the site id: `hh-fw`, `hq-esx1`.
- **Text**: data files never contain user-visible text. A field ending in `Key` holds one translation key,
  a field ending in `Keys` holds a list. Exceptions, never translated: hostnames, model names, commands,
  config snippets, IPs.
- **Placeholders** in translations: `{name}`. Values come from the data (`{ip}`, `{site}`, `{port}`).
- **Illustrative numbers** (lead times, prices, durations, retention periods) carry `"illustrative": true`
  at file or item level; the UI then shows the "illustrative" label.
- **Addresses**: internal `10.<site>.<vlan>.0/24`, gateway `.1`. Public addresses only from the
  documentation ranges `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`. Domain: `pfotenwerk.example`.
- **Company name**: one constant, `ORG_NAME` in `src/config.ts`, inserted into texts as `{org}`.

## 2. Files

| File | Module | Content |
|---|---|---|
| `topology.json` | A, B, all | VLANs, sites, clinic template, HQ devices, links, services, access policy |
| `roles.json` | A, B | Device roles: icon, default dependencies, capabilities, text keys |
| `faults.json` | B | Fault types, test steps, impact / fix texts, ready-made scenarios |
| `issues.json` | C | Ticket catalogue |
| `playbook.json` | D | Opening phases, checklists, artefacts |
| `catalog.json` | D | Shop items, scaling rules, pre-flight checks, delivery steps |
| `standards.json` | E | Kit reasons, firmware rollout, Ansible example, zero-touch flow, before/after |
| `cluster.json` | F | Hosts, VMs, rules, HA/DRS settings, SPOF table |
| `privacy.json` | G | Data categories, measures mapped to map locations, day-1 checklist |
| `monitoring.json` | H | Static checks, on-call example, early warnings, release flow |

`roles.json`, `standards.json` and `monitoring.json` are additions to the list in the brief, needed so that
modules E and H and the role texts are data-driven too.

## 3. Translations

```
src/i18n/
  en/  ui.json  topology.json  roles.json  faults.json  issues.json  playbook.json ...
  de/  (same files)
  tr/  (same files)
```

- One folder per language, one file per namespace; the key is `<namespace>.<path>`, e.g.
  `faults.impact.pay.down.simple`. (The brief names `en.json` / `de.json` / `tr.json`; one file per
  language would reach roughly 1,500 keys, so it is split. Same rule, smaller files.)
- English is the reference. `validate-data` **fails** if a key is missing in `de` or `tr`, if a key used
  in a data file does not exist, or if placeholders differ between languages. Unused keys are warnings.
- Length rule (brief section 2): a text over 280 characters or with more than 3 sentences is a warning,
  over 400 characters an error.
- Simple and Technical texts are two keys with the suffixes `.simple` and `.technical`.

## 4. `topology.json`

```jsonc
{
  "meta": { "version": "1.0.0", "updated": "2026-11-14" },
  "vlans": [],          // 4.1
  "sites": [],          // 4.2
  "templates": {},      // 4.3  clinic template
  "zones": [],          // 4.4  explicit zones (HQ, internet, cloud)
  "devices": [],        // 4.5  explicit devices (HQ, internet, cloud)
  "links": [],          // 4.6
  "services": [],       // 4.7
  "accessPolicy": {}    // 4.8
}
```

At load time `expandTopology()` turns every site with a `template` into concrete zones, devices and links.
Everything after that (index, layout, engine) only sees the expanded form. **Adding a clinic = one entry in
`sites`.**

### 4.1 `vlans`

| Field | Type | Notes |
|---|---|---|
| `id` | 1–4094 | |
| `name` | string | Technical name, e.g. `POS` |
| `labelKey`, `purposeKey` | key | |
| `color` | `#RRGGBB` | Always shown together with the number, never colour alone |
| `scope` | `all` \| `hq` | `hq` = exists only at HQ |
| `dhcp` | boolean | Pool served by the site firewall |
| `internet` | `full` \| `restricted` \| `none` | Shortcut for the legend; the real rules are in `accessPolicy` |

Subnet and gateway are **computed** from the site number, not stored.

Planned content: 10 Management, 20 Staff, 30 Medical, 40 POS, 50 Printers, 60 VoIP, 100 Guest (all sites);
70 Servers, 80 vMotion, 90 Storage (HQ only, 80 and 90 not routed).

### 4.2 `sites`

| Field | Type | Notes |
|---|---|---|
| `id` | id | `hq`, `ber`, `hh`, `muc` |
| `number` | 0–254 | Second octet |
| `code` | string | Hostname prefix: `HQ`, `BER`, `HH`, `MUC` |
| `kind` | `hq` \| `clinic` | |
| `template` | template id | Clinics only |
| `variant` | `large` \| `medium` | Selects template items |
| `features` | `("xray" \| "lab" \| "ultrasound")[]` | |
| `status` | `live` \| `planned` | `planned` = outlined on the map, no traffic (München until Module D completes) |
| `labelKey`, `city` | key, string | |
| `map` | `{ x, y }` | Position on the Germany schematic (0–100) |

### 4.3 `templates.clinic`

Same shape as `zones` / `devices` / `links`, with placeholders `{site}` (id), `{code}`, `{n}` (number):

```jsonc
{
  "zones":   [{ "id": "{site}-cabinet", "kind": "cabinet", "labelKey": "topology.zone.cabinet" }],
  "devices": [
    { "id": "{site}-fw",  "name": "{code}-FW-01", "role": "clinic-firewall", "zone": "{site}-cabinet",
      "vlan": 10, "ip": "10.{n}.10.1", "power": ["{site}-ups"] },
    { "id": "{site}-sw2", "name": "{code}-SW-02", "role": "access-switch", "zone": "{site}-cabinet",
      "vlan": 10, "ip": "10.{n}.10.3", "power": ["{site}-ups"], "when": { "variant": ["large"] } },
    { "id": "{site}-xray-pc", "name": "{code}-XRAY-01", "role": "xray-pc", "zone": "{site}-xray",
      "vlan": 30, "ip": "10.{n}.30.10", "when": { "feature": "xray" } }
  ],
  "links": [
    { "id": "{site}-wan1", "a": { "device": "{site}-fw", "port": "wan1" }, "b": { "device": "isp-{site}" },
      "kind": "wan", "medium": "fiber", "role": "primary" }
  ]
}
```

`when` filters an item by `variant` and/or `feature`. The same template feeds Module E (config diff
Hamburg vs München) and Module D (IP plan for `10.3.x.0/24`).

### 4.4 `zones`

| Field | Type | Notes |
|---|---|---|
| `id`, `site` | id | `site` is implied inside a template |
| `kind` | `cabinet` \| `server-room` \| `reception` \| `treatment` \| `xray` \| `lab` \| `office` \| `waiting` \| `cluster` \| `outside` \| `cloud` | |
| `parent` | zone id | Optional nesting (e.g. `cluster` inside `server-room`) |
| `labelKey` | key | |

Two zones exist outside any site: `internet` (ISPs, payment provider, vendor support) and `cloud`
(load balancer, practice management app, MDM, firewall management).

### 4.5 `devices`

| Field | Type | Notes |
|---|---|---|
| `id` | id | |
| `name` | string | Hostname, not translated |
| `role` | role id | From `roles.json`; drives icon, texts and default dependencies |
| `site`, `zone` | id | |
| `model` | string | Generic, e.g. "PoE switch 24 port" |
| `vlan` | VLAN id | Access VLAN / management VLAN |
| `ip` | IPv4 | Static address; must be inside the computed subnet |
| `dhcp` | boolean | Address comes from the pool; needs the `dhcp` service |
| `power` | device id[] | Power sources. Powered if **any** source is up. Omitted = always powered (cloud, ISP) |
| `group` | string | Redundancy group (`hq-fw-ha`, `hq-core-mlag`); members back each other up |
| `groupMode` | `active-passive` \| `active-active` | |
| `needs` | Need[] | Extra dependencies on top of the role defaults |
| `noteKey` | key | Optional device-specific note |

VMs are devices with `role` of a VM kind; their host placement is **not** stored here but in
`cluster.json` (section 9), because it changes during simulation.

### 4.6 `links`

| Field | Type | Notes |
|---|---|---|
| `id` | id | Required (faults reference links) |
| `a`, `b` | `{ device, port? }` | |
| `kind` | `lan` \| `wifi` \| `wan` \| `vpn` \| `storage` \| `virtual` | Also selects the animal: `lan`/`wifi` cat, `vpn` dog, `wan` mouse |
| `medium` | `copper` \| `fiber` \| `cable` \| `dsl` \| `lte` \| `wireless` \| `ipsec` | Line pattern and label |
| `role` | `primary` \| `backup` | Backup links carry traffic only when the primary path is gone; result is then "degraded, failover active" |
| `via` | link id | `vpn` only: the WAN link this tunnel rides on |
| `speed` | string | Free text |
| `vlans` | VLAN id[] | Trunk content, for the technical view |

VPN tunnels are overlay links: `vpn-hh-1` (`via` the primary WAN link) and `vpn-hh-2` (`via` LTE). A tunnel is
up when its `via` link is up, both firewalls are up, and HQ is reachable from the internet through at least
one ISP. Wi-Fi clients get a `primary` link to their nearest AP and a `backup` link to the next one, which
models roaming.

### 4.7 `services`

| Field | Type | Notes |
|---|---|---|
| `id` | id | `dhcp`, `dns-local`, `dns-internal`, `identity`, `pacs`, `lab-interface`, `files`, `pms`, `payment`, `mdm`, `monitoring`, `backup`, `ntp`, `vendor-support` |
| `labelKey` | key | |
| `scope` | `site` \| `global` | `site`: every site has its own instance |
| `providerRole` | role id | For `scope: site`: the device with this role in the same site |
| `providers` | device id[] | For `scope: global` |
| `redundancy` | `any` \| `all` | `any` = one reachable provider is enough |
| `upstream` | service id[] | A service that itself depends on others (`dns-local` forwards the internal zone to `dns-internal`) |

### 4.8 `accessPolicy`

Same model as the old app (ordered rules, first match wins, default action), with named targets:

```jsonc
{
  "defaultAction": "deny",
  "enforcedOnRole": ["clinic-firewall", "hq-firewall"],
  "rules": [
    { "id": "pos-payment", "from": [40], "to": ["payment"], "action": "permit",
      "services": ["https"], "descriptionKey": "topology.rule.posPayment" },
    { "id": "pos-isolated", "from": [40], "to": ["any"], "action": "deny",
      "descriptionKey": "topology.rule.posIsolated" }
  ]
}
```

`from`: VLAN id or `any`. `to`: VLAN id, `any`, `internet`, or a named target (`hq-servers`, `pacs`,
`payment`, `vendor-support`, `cloud-app`). The VLAN matrix and the per-device "may reach" list are derived
from these rules.

## 5. `roles.json`

One entry per device role. Clinics are identical, so almost all text and dependency logic sits here once.

```jsonc
{
  "id": "card-terminal",
  "icon": "card-terminal",
  "layer": "endpoint",                      // infrastructure | endpoint | server | external
  "labelKey": "roles.cardTerminal.label",
  "summaryKey": "roles.cardTerminal.summary",      // .simple / .technical
  "needs": ["dhcp", "dns-local"],                  // to be "online" at all
  "capabilities": [
    { "id": "pay", "audience": "reception", "needs": ["payment"] }
  ]
}
```

- **`needs`**: services the device requires to count as working on the network.
- **`capabilities`**: what people do with the device. Each has its own `needs`; this is how one fault
  produces "POS works, X-ray upload does not".
- **`audience`**: `reception` \| `vets` \| `owners` \| `backoffice` \| `it`. Groups the "who is affected" list.
- `optional: true` on a need means its loss degrades instead of breaking.

## 6. `faults.json` and the engine contract

```jsonc
{
  "faultTypes": [
    { "id": "power-off", "targets": ["device"], "labelKey": "faults.type.powerOff" },
    { "id": "link-cut", "targets": ["link"], "labelKey": "faults.type.linkCut" },
    { "id": "degrade", "targets": ["link", "device"], "labelKey": "faults.type.degrade" },
    { "id": "service-failure", "targets": ["service"], "variants": ["dns-stopped", "dhcp-exhausted", "cert-expired", "tunnel-down"], "labelKey": "faults.type.serviceFailure" }
  ],
  "testSteps": [
    { "id": "link-led", "layer": "link", "checkKey": "faults.test.linkLed" },
    { "id": "ping-gw", "layer": "gateway", "checkKey": "faults.test.pingGateway", "command": "ping {gateway}" }
  ],
  "impacts": [
    { "capability": "pay", "state": "down", "textKey": "faults.impact.pay.down" }
  ],
  "guides": [
    { "match": { "fault": "power-off", "role": "access-switch" },
      "chainKey": "faults.chain.switchOff", "tests": ["power-led", "link-led", "ping-gw"],
      "workaroundKey": "...", "fixKey": "...", "preventionKey": "..." }
  ],
  "scenarios": [
    { "id": "monday-hh-switch", "labelKey": "faults.scenario.mondayHamburg",
      "faults": [{ "type": "power-off", "target": { "kind": "device", "id": "hh-sw1" } }] }
  ]
}
```

- `testSteps[].layer` is one of `power → link → ip → dns → gateway → wan → vpn → service`. The UI always
  sorts by this order, which gives the bottom-up test sequence.
- `guides` are matched most specific first (`fault + role + outcome`, then `fault + role`, then `fault`).

### Engine types (`src/engine/types.ts`)

```ts
type Fault = {
  type: 'power-off' | 'link-cut' | 'degrade' | 'service-failure';
  target: { kind: 'device' | 'link' | 'service'; id: string; site?: string };
  variant?: 'dns-stopped' | 'dhcp-exhausted' | 'cert-expired' | 'tunnel-down';
  vlan?: number;                       // e.g. DHCP pool of one VLAN
};

type State = 'up' | 'degraded' | 'down';

interface SimulationResult {
  devices: Record<string, { state: State; powered: boolean; cause?: Cause }>;
  links: Record<string, { state: State | 'standby'; carrying: boolean }>;
  services: Record<string, { state: State; reachableProviders: string[] }>;  // key: "<site>/<service>"
  capabilities: Array<{ device: string; capability: string; audience: string; state: State; cause: Cause }>;
  sites: Record<string, { wan: 'primary' | 'backup' | 'offline'; vpn: 'primary' | 'backup' | 'down'; state: State }>;
  chain: Array<{ step: number; textKey: string; params: Record<string, string>; subject: string }>;
  affected: Array<{ site: string; audience: string; state: State; textKey: string; params: Record<string, string> }>;
  tests: Array<{ layer: string; checkKey: string; command?: string }>;
  remedy: { workaroundKeys: string[]; fixKeys: string[]; preventionKeys: string[] };
  redundancyWarnings: Array<{ group: string; textKey: string }>;
}

function simulate(topology: ExpandedTopology, roles: Roles, guides: FaultData,
                  cluster: ClusterData, faults: Fault[]): SimulationResult;
```

Evaluation order inside `simulate` (pure, no UI, no text):

1. **Power**: a device is powered if it has no `power` list or any source is powered and not faulted.
2. **Links**: a link is usable if both ends are powered and it is not cut. Backup links are `standby`
   unless the primary path is unusable.
3. **Cluster**: for HQ host faults, `placeVms()` from the cluster engine decides which VMs run where.
4. **Tunnels**: derived as in 4.6.
5. **Reachability**: per device, graph search over usable links to each provider of each needed service,
   respecting `accessPolicy` at firewalls.
6. **Services**: `any` / `all` redundancy, then `upstream`.
7. **Capabilities**: state per device capability; a path over a backup link or a reduced redundancy group
   gives `degraded`.
8. **Texts**: keys looked up in `faults.json`; the root cause chain is ordered by graph distance from
   the fault.

## 7. `issues.json` (Module C)

| Field | Notes |
|---|---|
| `id`, `category` | `printing` \| `payment` \| `wifi` \| `files` \| `imaging` \| `lab` \| `vpn` \| `internet` \| `voip` \| `accounts` \| `updates` \| `storage` \| `certificates` \| `mdm` |
| `symptomKey` | As the user says it |
| `causeKeys` | Ordered by probability |
| `checkKeys` | Ordered |
| `solutionKey` | |
| `show` | `{ roles: [...], site?: id }` for "Show on map" |
| `simulate` | Optional `Fault[]` for the "Simulate" button |

## 8. `playbook.json` and `catalog.json` (Module D)

**`playbook.json`**: `{ site: "muc", illustrative: true, goLiveWeek: 0, phases: [...] }`. Phase:
`id`, `labelKey`, `startWeek` (negative = T-minus), `durationWeeks`, `peopleKeys`, `pitfallKeys`,
`checklist: [{ id, labelKey, privacy?: boolean }]`, `artefact: { type, ... }` where `type` is
`checklist` \| `survey-sheet` \| `bom` \| `ip-plan` \| `validation`. `bom` and `ip-plan` are generated
from `catalog.json` and the clinic template, not stored.

**`catalog.json`**:

| Section | Fields |
|---|---|
| `items[]` | `sku`, `category`, `role`, `model`, `standard: boolean`, `leadTimeDays`, `hqStock`, `warningKey` (non-standard only), optional `ports`, `poeBudgetW`, `poeDrawW`, `loadVa`, `capacityVa`, `licence`, `mdmChannel`, `priceEur` |
| `scaling[]` | `sku` + structured rule: `{ fixed, perTreatmentRoom, perReceptionDesk, perFeature: { xray, lab }, perAreaM2: { every, add } }`. No expression strings, nothing is evaluated |
| `spares[]` | `sku`, `count` |
| `preflight[]` | `id`, `check` (`ports` \| `poe` \| `ups` \| `licences` \| `mdm-channel` \| `spares` \| `lead-time`), `labelKey`, `failKey` |
| `delivery[]` | `id`, `labelKey`, `days` |
| `defaults` | Inputs used by "Play automatically" |

## 9. `cluster.json` (Module F)

| Section | Fields |
|---|---|
| `hosts[]` | `id` (= device id in the topology), `cpuCores`, `ramGb`, `uplinks: [core switch ids]` |
| `vms[]` | `id` (= device id), `vcpu`, `ramGb`, `restartPriority` (`highest` \| `high` \| `medium` \| `low`), `initialHost` |
| `rules[]` | `{ type: "anti-affinity", vms: [...] }` |
| `ha` | `admissionControl: { tolerateHostFailures: 1 }`, `restartDelaySec` (illustrative), `isolationResponse` |
| `drs` | `mode`, `imbalanceThresholdPct` |
| `storage` | `type: "shared-array"`, `controllers: [ids]`, `pathsPerHost`, `alternativeKey` (the vSAN sentence) |
| `networks[]` | `id`, `purpose` (`management` \| `vmotion` \| `storage` \| `vm`), `vlan` |
| `spof[]` | `componentKey`, `redundantHowKey`, `ifFailsKey`, `fault?` |
| `before` | The "one server per service" picture: `servers: [{ nameKey, serviceKey }]` |

The cluster logic (`placeVms`, `haRestart`, `drsRecommend`, `admissionCheck`) is a second pure module in
`src/engine/cluster.ts`, used by Module F directly and by `simulate()` for HQ host faults.

## 10. `standards.json`, `privacy.json`, `monitoring.json`

- **`standards.json`**: `kit[]` (`sku`, `reasonKey`), `rollout` (`stages[]`, firmware versions),
  `ansible` (`inventory`, `playbook` as literal text, `run[]` of `{ host, status: ok | changed | failed, messageKey? }`),
  `zeroTouch[]` (5 steps), `comparison` (`without[]`, `with[]`, illustrative). The dashboard site list and
  the config diff are derived from the topology and the simulation state.
- **`privacy.json`**: `categories[]` (`owner`, `staff`, `payment`), `points[]`
  (`id`, `location`: `clinic` \| `transit` \| `hq` \| `cloud` \| `organization`; `target`: `{ roles?, linkKinds?, zones? }`;
  `categories`; `activity`: `stored` \| `processed` \| `transmitted`; `measureKey`; `exampleKey`),
  `day1[]` (`labelKey`, `playbookItem?`).
- **`monitoring.json`**: `staticChecks[]` (backup, certificates), `onCall[]` (`time`, `phase`, `textKey`),
  `earlyWarnings[]`, `release` (`steps[]`, `checks[]`). WAN, VPN, Wi-Fi and cluster rows of the status board
  come from the live `SimulationResult`.

## 11. Validation (`npm run validate-data`)

Stage 1, zod: shapes, id format, IPv4, VLAN range, enums.
Stage 2, cross-references (errors unless noted):

- Unique ids; every referenced device, link, zone, site, role, service, SKU, VLAN exists.
- Template expansion produces no duplicate ids; every `ip` lies inside `10.<site>.<vlan>.0/24`; no duplicate IPs.
- Every device with `dhcp: true` sits in a VLAN with `dhcp: true`.
- Every `vpn` link has a `via` link of kind `wan` on the same clinic firewall.
- Every service has at least one provider; `power` graphs have no cycles.
- Anti-affinity rules are satisfiable; initial VM placement fits the hosts.
- Every scenario and every issue `simulate` entry is a valid fault.
- Translation checks from section 3.
- Warning: a device no capability or need can ever reach (probably a missing link).

## 12. Folder structure

```
src/
  config.ts              ORG_NAME, repo URL, storage prefix
  data/                  the JSON files above
  schema/                zod schemas, types, validate.ts, expandTopology.ts
  engine/                simulate.ts, reachability.ts, cluster.ts, types.ts, *.test.ts
  i18n/                  I18nContext.tsx, en/ de/ tr/
  context/               PrefsContext, MapContext, SimContext
  hooks/                 useLocalStorage, useTheme, useMediaQuery, useMapZoom, useHashRoute
  components/
    layout/              Header, Nav, Footer
    map/                 MapCanvas, DeviceNode, SiteNode, ZoneNode, PetEdge, pets/
    panels/              SidePanel (bottom sheet on phones), DeviceDetails, LinkDetails
    common/              StatusBadge, VlanBadge, Card, Checklist, CodeBlock
  modules/
    a-map/  b-simulator/  c-issues/  d-opening/  e-standards/  f-ha-lab/  g-privacy/  h-monitoring/  about/
  utils/                 ip, graph, access, cn, layout
docs/                    SCHEMA.md, REUSE.md
scripts/                 validate-data.ts
```

## 13. Corrections to the brief

Places where following the brief literally would be technically wrong or contradictory, with the
correction this schema assumes. Each is open for review.

1. **Clinic DNS and DHCP must be local.** Must-have scenario "VPN down but internet up → POS and cloud app
   work" only holds if clinics do not depend on HQ for DHCP and public DNS. Correction: the clinic firewall
   serves DHCP and is the DNS resolver; it forwards only the internal zone to the two HQ DNS servers.
   Consequence for "both HQ DNS servers down": clinics lose internal names (PACS, file server), internet
   names keep working.
2. **MDM is a cloud service, not an HQ VM.** Zero-touch enrolment happens in the setup assistant, before
   any VPN exists, so the Mac must reach the MDM from the internet. Correction: MDM sits in the cloud zone;
   the HQ VM becomes an automation/management host (Ansible, config backups).
3. **Storage: shared array, not vSAN.** The required scenarios "one storage path / controller down" belong
   to a dual-controller array with multipathing, so that is modelled. vSAN is the one-sentence
   alternative, with the honest note that a 3-node vSAN with FTT=1 stays available after a host loss but
   cannot rebuild until the host is back.
4. **HQ needs VLANs beyond the clinic plan**: 70 Servers, 80 vMotion, 90 Storage. The seven clinic VLANs
   stay identical everywhere.
5. **"Lab server" does not exist in the HQ VM list.** The Medical VLAN is allowed to reach "PACS/lab server"
   only. Correction: add a small lab interface VM at HQ that receives analyzer results and hands them to
   the practice management app.
6. **POS isolation vs. receipt printer.** If VLAN 40 is isolated from everything, the receipt printer
   cannot live there and be used by the reception Mac. Correction: the card terminal is alone in VLAN 40
   (payment provider, DNS and NTP only); the receipt printer is in VLAN 50 and prints from the Mac.
7. **Two UPS at HQ.** "Dual power feeds per host" on a single UPS is still a single point of failure.
   Correction: UPS A and UPS B, one feed each.
8. **Core switches as MLAG pair**, not a stack: two independent control planes, so one can be updated or
   fail without the other. (The brief allows either.)
9. **VPN details that affect the simulation.** LTE usually sits behind carrier NAT, so the clinic always
   initiates the tunnel. HQ has two ISPs, so each clinic tunnel knows two HQ peer addresses; "ISP 1 down at
   HQ" makes all clinic tunnels re-establish to the second address (short interruption, then up).
10. **Mac login does not depend on HQ.** With MDM-managed Macs and local accounts, an HQ identity outage
    blocks file shares and admin logins but not the Mac login itself. The engine models it that way.
11. **Drill-down has two canvases** (overview, site), because the old app has no drill-down to take over;
    see `REUSE.md`.
12. **HA wording.** N+1 on three hosts means one third of the cluster capacity stays reserved; the
    admission-control slider in Module F is built on that number. HA restarts keep working without vCenter,
    DRS does not; vCenter is itself a VM in the cluster.

## 14. Changes made while implementing (Phase 2)

The sections above are the Phase 0 proposal. Where the implementation differs, this list wins;
`src/schema/topology.schema.ts` is the reference.

- **Text keys by convention.** Roles, sites, VLANs and services have no `labelKey` field. Their texts
  are found by id: `roles.<id>.label|simple|technical`, `topology.site.<id>.label|simple|technical`,
  `topology.vlan.<id>.label|purpose`, `topology.service.<id>`. The validator requires all of them.
  Zones, notes and access rules keep explicit `…Key` fields.
- **Sites**: new kind `external` (the pseudo-site "Internet & cloud", no number); `labelKey` and `city`
  dropped; `map` may lie outside 0–100.
- **Zones**: flat, no `parent`. New layout hints `row` (zones with the same row sit side by side) and
  `cols`; `number` fills `{n}` in the label. Kinds added: `virtual`; HQ uses `server-room`, `cluster`,
  `virtual`, `office`.
- **Devices**: `runsOn` (the host a VM starts on) is stored in the topology after all; expansion turns it
  into a `virtual` link. `cluster.json` will only hold resources and rules.
- **Services**: per-site services use `providerRoles` (a list) instead of `providerRole`.
- **Access policy**: targets are VLAN ids, `any`, `internet` and `hq-servers` only. `serviceKeys`
  (translation keys) replace `services`; `enforcedOnRoles` replaces `enforcedOnRole`.
- **roles.json**: `id`, `icon`, `layer`, `needs`. `capabilities` follow in Phase 4 with the engine.
- **Layout without elkjs.** Zone rows and device grids are computed by a small deterministic function
  (`src/utils/layout.ts`). The result is predictable and the bundle is about 1.4 MB smaller, so elkjs
  is not installed.
- **Map state in the URL**: `#/?site=hh&device=hh-fw`, `#/?view=rules`.

## 15. Changes made while implementing (Phase 4, engine)

`src/engine/types.ts` is the reference for the result; section 6 above was the proposal.

- **Signature**: `simulate(topology, faults, { roles, cluster })`. The healthy baseline is computed once
  per topology and cached.
- **roles.json** gained `forwards` (passes traffic on), `battery` (UPS), and `capabilities`
  (`id`, `audience`, `needs`). `needs` on the role itself is what a device needs to be on the network at
  all. A need is a service id or `role:<role id>` (a device of that role must be reachable, e.g. the
  receipt printer for the reception Mac).
- **New service `gateway`** (per site, the firewall): being able to leave one's own network.
- **cluster.json** exists with hosts, VMs (memory, restart priority), the anti-affinity rule and the storage
  controllers. Module F extends it.
- **Faults**: `{ type, target, variant?, service? }`. `target` is a device, a link, or a service
  (optionally narrowed by `site` and `vlan`). The pseudo-service `vpn` with a `site` takes down all
  tunnels of that clinic.
- **Result**: `devices`, `links`, `capabilities`, `sites`, `chain`, `affected`, `warnings`, `healthy`.
  There is no `services` map; service problems appear as `service-down` / `service-degraded` events in
  the chain. Every failed capability carries a `cause` that points to the responsible fault.
- **Two kinds of path that never mix**: internal (LAN, Wi-Fi, VPN, storage) and external (LAN, Wi-Fi,
  WAN). A clinic reaches HQ servers only through a tunnel and cloud services only through its own line.
- **Access rules are not evaluated by the engine.** They describe the design and do not change when
  something breaks; the engine works on power, links, tunnels and services.
- **Texts are not part of the engine.** Tests, fixes and sentences are attached in Phase 5 from
  `faults.json`, keyed by fault type, role and outcome.

## 16. `faults.json` and the explanation layer (Phase 5)

`src/engine/explain.ts` is the reference. It sits between the engine and the UI and still produces
no sentences: translation keys plus ids, resolved to names by the UI in the current language and mode.

- **`actions`**: what the user can do to a device or link (`on`, `type`, `variant`, optional `roles` /
  `kinds` filter). `target` says how the engine fault is built from the clicked element:
  the element itself, a service of its site (`site-service`, optionally one VLAN), the device stops
  providing one service (`provider`), or the global service it provides fails for everyone
  (`provided-service`).
- **`testSteps`**: one check each, with its `layer` (`power → link → ip → dns → gateway → wan → vpn →
  service`) and an optional command. `{ip}` and `{gateway}` are filled from the faulted device; a
  command whose placeholders cannot be filled is not shown.
- **`guides`**: matched in file order, first match wins, so specific guides (action + role) come before
  general ones (action only). Each names its test steps; workaround, fix and prevention texts are found by
  convention at `faults.guide.<id>.workaround|fix|prevention`.
- **`scenarios`**: ready-made fault sets with the site to open. Linkable as `#/simulator?scenario=<id>`.
- **Validation** fails if an action can be applied to some device or link but no guide matches it, if a
  scenario's action does not fit its target, or if any text key is missing in a language.
- **Service events** in the chain are reported only for devices that still reach their own site's
  firewall. A device that is simply cut off does not make "the image archive" fail; the archive is fine.
  Per site, the failing services are merged into one line.
- **Text keys by convention**: `faults.action.<id>.label|done`, `faults.test.<id>`, `faults.layer.<id>`,
  `faults.scenario.<id>`, `faults.event.<kind>`, `faults.warning.<kind>`, `faults.outcome.<outcome>`,
  `faults.cap.<capability>`, `faults.audience.<audience>`.
- **State**: active faults live in memory (`SimContext`) above all pages; the map shows the same simulated
  network as the simulator. A reload starts healthy.

## 17. HA lab and other changes (Phase 6)

- **Pet traffic removed.** At the user's request the animated animals on map links were dropped
  (brief Module A and Phase 3). Link states stay visible through line style and markers.
- **`cluster.json`** gained `ha` (illustrative timing: detection, gap between restart waves, boot,
  vMotion, in seconds), `drs.thresholdPct`, `spof[]` (rows of the single-point-of-failure table, texts at
  `ha.spof.<id>.component|how|fails`, optional `try` = the device or link the "Try it" button breaks) and
  `before[]` (service ids for the "one server per service" picture).
- **VM sizes and placement** changed so that every single host failure can really be absorbed. The
  validator now checks N+1 by placing the VMs for each possible host failure, not by adding up free
  memory: free space split over two hosts does not fit one large VM.
- **`src/engine/haLab.ts`** holds the lab logic (host health from power, uplinks and storage paths;
  HA restart and vMotion; DRS; admission control; anti-affinity status). Storage is modelled as two
  fabrics: host uplink to core switch N plus controller port on core switch N is one path.
- **The lab is its own playground.** Network effects (power, ISPs, firewall pair, switches) come from the
  main engine; the lab does not change the faults of the failure simulator.

## 18. `issues.json` (Phase 7)

`src/schema/issues.ts` is the reference; section 7 above was the proposal.

- **Fields**: `id`, `category` (from `categories`), `kind` (`incident` | `request`), `causes` and `checks`
  (how many numbered texts exist, at most 3 and 4), `show` (`site` to open, `roles` to highlight) and an
  optional `simulate` list of `{ action, target }` from `faults.json`.
- **Texts by convention**: `issues.category.<id>`, `issues.item.<id>.symptom | solution | causes.<n> |
  checks.<n>`. For requests (on- and offboarding) the UI calls causes "what usually goes wrong" and checks
  "steps".
- **Links**: "Show on map" opens `#/?site=<site>&issue=<id>` and highlights every device of the listed roles
  in that site plus those at HQ and in the cloud; "Simulate" opens `#/simulator?issue=<id>` and loads the
  faults.
- **Validation** fails on unknown roles or sites, on a `simulate` action that does not fit its target, and on
  any missing text. A test checks that every simulation actually affects someone.

## 19. `playbook.json` and `catalog.json` (Phase 8a)

`src/schema/playbook.ts` is the reference; section 8 above was the proposal.

- **`playbook.json`**: `site` (the clinic being opened, `planned` in the topology), `liveAfter` (the phase
  after which it counts as live), `dhcpPool` (host range used in the IP plan) and `phases[]` with
  `startWeek` (relative to go-live), `weeks`, `people`, `checklist` (item ids), `pitfalls` (count) and one
  `artefact`: `list` (with an id and an item count), `bom`, `ip-plan` or `port-plan`.
- **Texts by convention**: `opening.phase.<id>.title | goal | check.<item> | pitfall.<n>`,
  `opening.people.<id>`, `opening.artefact.<id>.title | item.<n>`.
- **`catalog.json`** (started here, extended in 8b): items with `sku`, `model`, `role` (gives the name) or
  `labelKey`, `port`, `poeW` / `poeBudgetW`, `vendor` (supplied by the medical device vendor) and a structured
  `rule`: `fixed`, `perRoom`, `perDesk`, `perFeature`, or `perPorts` for the switch. Nothing is evaluated as an
  expression. The brief's example (4 rooms → 3 access points, 6 Macs, 2 card terminals) is a test.
- **Computed artefacts**: the IP plan comes from the VLAN plan and the site number, the port plan from the
  clinic template, the bill of materials from the catalog rules.
- **Going live**: ticking every step up to `liveAfter` switches the simulation to `TOPOLOGY_OPENED` (the same
  data with the site live) and the map draws it like the other clinics. Progress is kept in memory only.

## 20. Procurement simulation (Phase 8b)

`src/schema/procurement.ts` holds the logic; `catalog.json` grew to carry it.

- **Catalog items** gained `category` (shop shelf; vendor-supplied ports have none and are not sold),
  `leadDays`, `hqStock`, `warrantyMonths`, `ports` (usable switch ports), `loadW` / `capacityW` (cabinet load and
  UPS capacity), `channel` (`business` | `retail` for Macs), `licence` (`network` | `mdm`), `standard` and
  `replaces` (a non-standard item names the standard item it stands in for; its warning text is
  `shop.warn.<sku>`). Rules gained `minPerAreaM2` (access points by floor area) and `per` (licences: one per
  unit of the listed SKUs).
- **Catalog sections**: `categories`, `spares` (expected on top of the kit), `delivery` (steps, days after the last
  item reached HQ), `timing` (days from arrival at HQ until ready on site; days before go-live the installation
  needs it) and `defaults` (what "Play automatically" uses; they match the München template).
- **Checks**: complete kit, switch ports (including the vendor's medical devices), PoE budget, UPS size, licences
  (spares on the shelf need none), Mac purchase channel, spares, lead times, standard models. Most have a one-click
  fix that returns a corrected cart.
- **Result**: an inventory row per unit, mapped onto the template devices of the new clinic (hostname, room, VLAN,
  address); units beyond the template are marked additional or spare. Reaching the result ticks off the hardware
  phase; late items appear under the timeline with their consequence and a workaround (HQ stock, or later
  installation).
- **Texts**: namespace `shop` (`shop.ui.*`, `shop.category.*`, `shop.item.*`, `shop.warn.*`, `shop.check.<id>.title |
  ok | bad`, `shop.step.<id>`).
- **Not built**: prices (optional in the brief). Moving parcel and device tiles are shown in a small map inside the
  wizard, not on the main map.

## 21. `standards.json` (Phase 8c)

`src/schema/standards.ts` is the reference.

- **Fields**: `kitReasons` (texts `std.kit.reason.<id>`), `config` (HQ VPN peers and the HQ addresses for SNMP,
  syslog and NTP used in the rendered configuration), `firmware` (current and target version, observation time after
  the pilot), `rollout` (stages with their clinics; every clinic must be in one), `ansible` (`outcomes` per switch
  in a healthy network and the `failure` reason of the failing one), `zeroTouch` (step ids) and `comparison`
  (without / with standards, illustrative).
- **Computed**: the site configuration is rendered from the topology and the template variables (`site`, `code`,
  `n`); a test makes sure two clinics differ only in lines that carry those variables. The Ansible run covers the
  switches of live clinics; a switch that is off or whose clinic lost its tunnel in the failure simulator is
  `unreachable`. The fleet dashboard reads WAN, VPN and client counts from the simulation.
- **Not real syntax**: configuration, inventory and playbook are readable, vendor-neutral sketches.

## 22. `privacy.json` and `monitoring.json` (Phase 9)

`src/schema/compliance.ts` is the reference; section 10 above was the proposal.

- **`privacy.json`**: `categories` (owner, staff, payment), `locations` (clinic, transit, HQ, cloud,
  organisation), `measures` (id, location, categories, activity `stored` | `processed` | `transmitted`, and the
  device `roles` it applies to; organisational measures have none), `day1` and `retention` (labels only; every
  period is shown as a placeholder). The map's data protection layer (`#/?privacy=1`) highlights every device
  with a measure, shows the data categories on the node and lists the measures in the details panel.
- **`monitoring.json`**: `keyRoles` (key devices on the status board), `certificates` with days left and
  `warnDays`, `earlyWarnings` (device, value, limit), the `onCall` timeline with the scenario it can be simulated
  with, and the `release` flow with IT's checks.
- **Status board** (`statusBoard`): computed from the simulation for every live site (WAN, VPN, Wi-Fi, key devices)
  and HQ (hosts, VMs including HA restarts, storage controllers, backup with its offsite copy, certificates; an
  active `cert-expired` fault expires the certificate). In a healthy network the only alert is the certificate
  that expires in 14 days, on purpose.

## 23. More tickets and the first-visit tour (after Phase 10)

- **`issues.json`** has 26 tickets. Two optional flags: `critical` (the clinic cannot take money or data is at
  risk; shown as a badge) and `warning` (adds the text `issues.item.<id>.warning`: the mistake that makes it
  worse, such as retrying a payment without checking the journal). Card payment has seven tickets: connection,
  double charge, one card brand declined, both lines down, firewall change, daily closing, terminal swap.
- **Tour** (`src/components/tour/Tour.tsx`): six steps on the first visit, stored as `atlas:tourDone`. Steps
  point at elements with `data-tour="<id>"`; the first visible one wins (tab row on desktop, menu button on a
  phone). The "?" button in the header starts it again. Texts: `ui.tour.*`.
