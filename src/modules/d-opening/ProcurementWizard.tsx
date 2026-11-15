/**
 * "IT-Beschaffung": ordering the kit for München like from an internal shop.
 *
 *   1 Size      rooms, desks, floor area, X-ray, lab → the standard kit goes into the cart
 *   2 Shop      only approved models, plus a few non-standard ones that are allowed with a warning
 *   3 Checks    pre-flight list (green or amber, most with a one-click fix) and the order week
 *   4 Delivery  step by step from order to "online"; a parcel travels HQ → München and the
 *               devices appear, grey (installed), then coloured (online)
 *   5 Result    inventory table; late items with their consequence and workaround; the hardware
 *               phase of the timeline is ticked off
 *
 * "Play automatically" runs everything with the defaults from catalog.json.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Package, Pause, Play, RotateCcw, ShoppingCart, SkipForward } from 'lucide-react';
import { CATALOG, INDEX, PLAYBOOK } from '../../data';
import { usePrefs } from '../../context/PrefsContext';
import { useOpening } from '../../context/OpeningContext';
import { useI18n } from '../../i18n/I18nContext';
import type { BomInput, CatalogItem } from '../../schema/playbook';
import { computeBom } from '../../schema/playbook';
import { cartFromBom, inventory, preflight, schedule, sellable, type Cart, type Check } from '../../schema/procurement';
import { zoneLabel } from '../../components/map/labels';
import { RoleIcon } from '../../components/map/RoleIcon';
import { GERMANY_PATH } from '../../components/map/nodes';
import { cn } from '../../utils/cn';
import { Stepper, useCatalogNames } from './artefacts';

const STEPS = ['size', 'shop', 'checks', 'delivery', 'result'] as const;
type Step = (typeof STEPS)[number];
const D = CATALOG.defaults;
const defaultInput = (): BomInput => ({ rooms: D.rooms, desks: D.desks, areaM2: D.areaM2, features: { xray: D.xray, lab: D.lab } });
const ORDER_WEEKS = [-10, -9, -8, -7, -6, -5, -4, -3];
/** Real time per automatic step, in milliseconds */
const AUTO_MS = 1100;

/** Applies the one-click fixes until none is left (or a few rounds have passed). */
function fixAll(cart: Cart, input: BomInput, orderWeek: number): Cart {
  let next = cart;
  for (let i = 0; i < 6; i++) {
    const fix = preflight(CATALOG, next, input, orderWeek).find((c) => !c.ok && c.fix)?.fix;
    if (!fix) break;
    next = fix;
  }
  return next;
}

const count = (cart: Cart) => Object.entries(cart).reduce((s, [sku, n]) => s + (CATALOG.items.find((i) => i.sku === sku)?.licence ? 0 : n), 0);

export function ProcurementWizard() {
  const { t } = useI18n();
  const { setPhase, setLate } = useOpening();
  const [step, setStep] = useState<Step>('size');
  const [input, setInput] = useState<BomInput>(defaultInput);
  const [cart, setCart] = useState<Cart>({});
  const [orderWeek, setOrderWeek] = useState(D.orderWeek);
  const [delivery, setDelivery] = useState(0);
  const [playing, setPlaying] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const checks = useMemo(() => preflight(CATALOG, cart, input, orderWeek), [cart, input, orderWeek]);
  const arrivals = useMemo(() => schedule(CATALOG, cart, orderWeek), [cart, orderWeek]);
  const late = arrivals.filter((a) => a.lateDays > 0);
  const lastStep = CATALOG.delivery.length - 1;

  const fill = useCallback((inp: BomInput) => setCart(cartFromBom(computeBom(CATALOG, inp))), []);
  const order = () => {
    setDelivery(0);
    setStep('delivery');
  };
  const finish = useCallback(() => {
    setDelivery(lastStep);
    setStep('result');
  }, [lastStep]);

  // Reaching the result ticks off the hardware phase and reports late items to the timeline
  useEffect(() => {
    if (step !== 'result') return;
    setPhase('hardware', true);
    setLate(late.map((a) => ({ sku: a.sku, days: a.lateDays })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Automatic play: one action per tick
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (step === 'size') {
        const inp = defaultInput();
        setInput(inp);
        setOrderWeek(D.orderWeek);
        fill(inp);
        setStep('shop');
      } else if (step === 'shop') setStep('checks');
      else if (step === 'checks') {
        const fixed = fixAll(cart, input, orderWeek);
        if (fixed !== cart) setCart(fixed);
        else order();
      } else if (step === 'delivery') {
        if (delivery < lastStep) setDelivery(delivery + 1);
        else setStep('result');
      } else setPlaying(false);
    }, AUTO_MS);
    return () => window.clearTimeout(timer);
  }, [playing, step, delivery, cart, input, orderWeek, fill, lastStep]);

  const restart = () => {
    setPlaying(false);
    setStep('size');
    setInput(defaultInput());
    setCart({});
    setOrderWeek(D.orderWeek);
    setDelivery(0);
  };
  const play = () => {
    if (!playing && step === 'result') restart();
    setPlaying(!playing);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const stepIndex = STEPS.indexOf(step);
  const canGo = (s: Step) => {
    const i = STEPS.indexOf(s);
    if (i <= stepIndex) return true;
    if (s === 'shop' || s === 'checks') return count(cart) > 0;
    return false;
  };

  return (
    <section ref={topRef} className="scroll-mt-4 rounded-2xl border border-line bg-surface p-4" aria-label={t('shop.ui.title')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <ShoppingCart className="h-5 w-5 text-primary-strong" aria-hidden="true" />
            {t('shop.ui.title')}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('shop.ui.intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={play} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-on-primary hover:bg-primary-strong">
            {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {playing ? t('shop.ui.pause') : t('shop.ui.play')}
          </button>
          <button type="button" onClick={restart} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink hover:bg-raised">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('shop.ui.restart')}
          </button>
        </div>
      </div>

      <ol className="mt-4 flex flex-wrap items-center gap-1" aria-label={t('shop.ui.steps')}>
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-4 w-4 text-muted" aria-hidden="true" />}
            <button
              type="button"
              disabled={!canGo(s) || playing}
              onClick={() => setStep(s)}
              aria-current={s === step ? 'step' : undefined}
              className={cn(
                'min-h-11 rounded-lg px-2.5 text-sm font-medium disabled:opacity-40',
                s === step ? 'bg-primary-soft text-primary-strong' : i < stepIndex ? 'text-ink hover:bg-raised' : 'text-muted',
              )}
            >
              {i + 1}. {t(`shop.ui.step.${s}`)}
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-4" aria-live="polite">
        {step === 'size' && <SizeStep input={input} setInput={setInput} onFill={() => (fill(input), setStep('shop'))} />}
        {step === 'shop' && <ShopStep cart={cart} setCart={setCart} onNext={() => setStep('checks')} />}
        {step === 'checks' && <ChecksStep checks={checks} setCart={setCart} orderWeek={orderWeek} setOrderWeek={setOrderWeek} onOrder={order} />}
        {step === 'delivery' && <DeliveryStep cart={cart} input={input} orderWeek={orderWeek} index={delivery} onNext={() => (delivery < lastStep ? setDelivery(delivery + 1) : setStep('result'))} onSkip={finish} playing={playing} />}
        {step === 'result' && <ResultStep cart={cart} input={input} late={late} />}
      </div>
      <p className="mt-3 text-xs text-muted">{t('shop.ui.illustrative')}</p>
    </section>
  );
}

function SizeStep({ input, setInput, onFill }: { input: BomInput; setInput: (i: BomInput) => void; onFill: () => void }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <Stepper label={t('opening.bom.rooms')} value={input.rooms} min={1} max={8} onChange={(rooms) => setInput({ ...input, rooms })} />
        <Stepper label={t('opening.bom.desks')} value={input.desks} min={1} max={3} onChange={(desks) => setInput({ ...input, desks })} />
        <label className="flex min-h-11 items-center justify-between gap-2 text-sm text-ink">
          {t('shop.ui.area')}
          <input
            type="number"
            min={80}
            max={1500}
            step={10}
            value={input.areaM2}
            onChange={(e) => setInput({ ...input, areaM2: Math.max(80, Number(e.target.value) || 80) })}
            className="h-11 w-28 rounded-xl border border-line bg-surface px-3 text-right text-ink"
          />
        </label>
        {(['xray', 'lab'] as const).map((f) => (
          <label key={f} className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-5 w-5 accent-[var(--c-primary)]" checked={input.features[f]} onChange={(e) => setInput({ ...input, features: { ...input.features, [f]: e.target.checked } })} />
            {t(`opening.bom.${f}`)}
          </label>
        ))}
      </div>
      <div className="flex items-end">
        <button type="button" onClick={onFill} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-strong">
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
          {t('shop.ui.fill')}
        </button>
      </div>
    </div>
  );
}

function ShopItem({ item, n, setN }: { item: CatalogItem; n: number; setN: (n: number) => void }) {
  const { t, td } = useI18n();
  const { mode } = usePrefs();
  const { name } = useCatalogNames();
  const label = name(item);
  const btn = 'flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-lg text-ink hover:bg-raised disabled:opacity-40';
  return (
    <li className={cn('rounded-xl border p-3', !item.standard ? 'border-warn bg-warn-soft/50' : n > 0 ? 'border-primary/50' : 'border-line')}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised text-primary-strong">
          <RoleIcon icon={INDEX.roles.get(item.role ?? CATALOG.items.find((i) => i.sku === item.replaces)?.role ?? '')?.icon ?? 'archive'} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">
            {label}
            {mode === 'technical' && item.model && <span className="ml-1.5 font-mono text-xs text-muted">{item.model}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            <span>{t('shop.ui.lead', { days: item.leadDays ?? 0 })}</span>
            {!item.licence && <span>{item.hqStock ? t('shop.ui.stock', { n: item.hqStock }) : t('shop.ui.noStock')}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className={btn} disabled={n === 0} onClick={() => setN(n - 1)} aria-label={t('shop.ui.remove', { item: label })}>
            −
          </button>
          <output className="w-7 text-center text-sm font-semibold text-ink">{n}</output>
          <button type="button" className={btn} onClick={() => setN(n + 1)} aria-label={t('shop.ui.add', { item: label })}>
            +
          </button>
        </div>
      </div>
      {/* Full width below the row, so it stays readable next to the quantity buttons on phones */}
      {!item.standard && (
        <p className="mt-2 flex items-start gap-1 text-xs text-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
          <span>
            <span className="font-semibold">{t('shop.ui.nonStandard')}: </span>
            {td(`shop.warn.${item.sku}`)}
          </span>
        </p>
      )}
    </li>
  );
}

function ShopStep({ cart, setCart, onNext }: { cart: Cart; setCart: (c: Cart) => void; onNext: () => void }) {
  const { t, td } = useI18n();
  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-2">
        {CATALOG.categories.map((c) => (
          <div key={c}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{td(`shop.category.${c}`)}</h3>
            <ul className="space-y-2">
              {sellable(CATALOG)
                .filter((i) => i.category === c)
                .map((i) => (
                  <ShopItem key={i.sku} item={i} n={cart[i.sku] ?? 0} setN={(n) => setCart({ ...cart, [i.sku]: n })} />
                ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{t('shop.ui.cart', { count: count(cart) })}</span>
        <button type="button" onClick={onNext} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-strong">
          {t('shop.ui.next')}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function useCheckText() {
  const { t } = useI18n();
  const { name } = useCatalogNames();
  /** At most three names, then "+N more" */
  const names = (skus: string[]) => {
    const list = skus.slice(0, 3).map((s) => name(CATALOG.items.find((i) => i.sku === s)!)).join(', ');
    return skus.length > 3 ? `${list} ${t('sim.more', { count: skus.length - 3 })}` : list;
  };
  return (c: Check) => {
    const params = Object.fromEntries(Object.entries(c.params).map(([k, v]) => [k, Array.isArray(v) ? names(v) : v]));
    return t(`shop.check.${c.id}.${c.ok ? 'ok' : 'bad'}`, params);
  };
}

function ChecksStep(props: { checks: Check[]; setCart: (c: Cart) => void; orderWeek: number; setOrderWeek: (w: number) => void; onOrder: () => void }) {
  const { t } = useI18n();
  const text = useCheckText();
  const amber = props.checks.filter((c) => !c.ok).length;
  const week = (w: number) => t('opening.ui.weekMinus', { n: -w });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <ul className="space-y-1.5">
        {props.checks.map((c) => (
          <li key={c.id} className={cn('flex items-start gap-2.5 rounded-xl border p-2.5', c.ok ? 'border-line' : 'border-warn bg-warn-soft/60')}>
            {c.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden="true" />}
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium text-ink">{t(`shop.check.${c.id}.title`)}</div>
              <div className="text-muted">{text(c)}</div>
            </div>
            {!c.ok && c.fix && (
              <button type="button" onClick={() => props.setCart(c.fix!)} className="min-h-11 shrink-0 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-primary-strong hover:bg-raised">
                {t('shop.ui.fix')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="space-y-3">
        <p className={cn('rounded-xl p-3 text-sm font-medium', amber ? 'bg-warn-soft text-ink' : 'bg-ok-soft text-ink')} role="status">
          {amber ? t('shop.ui.attention', { count: amber }) : t('shop.ui.allGood')}
        </p>
        <label className="block text-sm text-ink">
          <span className="font-medium">{t('shop.ui.orderWeek')}</span>
          <select value={props.orderWeek} onChange={(e) => props.setOrderWeek(Number(e.target.value))} className="mt-1 h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink">
            {ORDER_WEEKS.map((w) => (
              <option key={w} value={w}>
                {week(w)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={props.onOrder} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-strong">
          <Package className="h-4 w-4" aria-hidden="true" />
          {t('shop.ui.order')}
        </button>
      </div>
    </div>
  );
}

/** HQ → München on a small Germany outline; the parcel moves when the shipment leaves. */
function MiniMap({ shipped }: { shipped: boolean }) {
  const { t } = useI18n();
  const hq = INDEX.sites.get('hq')!.map;
  const site = INDEX.sites.get(PLAYBOOK.site)!.map;
  const at = shipped ? site : hq;
  return (
    <svg viewBox="0 0 100 122" className="h-56 w-full" role="img" aria-label={t('shop.ui.parcel')}>
      <path d={GERMANY_PATH} className="fill-primary-soft stroke-primary" strokeWidth={0.6} strokeLinejoin="round" opacity={0.6} />
      <line x1={hq.x} y1={hq.y} x2={site.x} y2={site.y} stroke="var(--c-muted)" strokeWidth={0.6} strokeDasharray="2 2" />
      <circle cx={hq.x} cy={hq.y} r={2.4} className="fill-primary" />
      <circle cx={site.x} cy={site.y} r={2.4} className={shipped ? 'fill-primary' : 'fill-surface stroke-muted'} strokeWidth={0.6} strokeDasharray={shipped ? undefined : '1 1'} />
      <g style={{ transform: `translate(${at.x}px, ${at.y - 6}px)`, transition: 'transform 1s ease-in-out' }}>
        <rect x={-3.5} y={-3} width={7} height={6} rx={0.8} className="fill-accent stroke-accent-ink" strokeWidth={0.5} />
        <path d="M-3.5 -1 H3.5 M0 -3 V3" className="stroke-accent-ink" strokeWidth={0.5} />
      </g>
    </svg>
  );
}

function DeliveryStep(props: { cart: Cart; input: BomInput; orderWeek: number; index: number; onNext: () => void; onSkip: () => void; playing: boolean }) {
  const { t, td } = useI18n();
  const rows = useMemo(() => inventory(CATALOG, props.cart, INDEX, PLAYBOOK.site, props.input), [props.cart, props.input]);
  const placed = rows.filter((r) => r.device);
  const arrivalDay = Math.max(...schedule(CATALOG, props.cart, props.orderWeek).map((a) => a.arrivalDay));
  const reached = (id: string) => CATALOG.delivery.findIndex((d) => d.id === id) <= props.index;
  const dayOf = (i: number) => (i === 0 ? props.orderWeek * 7 : arrivalDay + CATALOG.delivery[i].day);
  const week = (day: number) => {
    const w = Math.floor(day / 7);
    return w < 0 ? t('opening.ui.weekMinus', { n: -w }) : w === 0 ? t('opening.ui.weekZero') : t('opening.ui.weekPlus', { n: w });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <ol className="space-y-1">
          {CATALOG.delivery.map((d, i) => (
            <li key={d.id} className={cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors', i === props.index ? 'bg-primary-soft' : '')}>
              {i <= props.index ? <CheckCircle2 className="h-5 w-5 shrink-0 text-ok" aria-hidden="true" /> : <span className="h-5 w-5 shrink-0 rounded-full border-2 border-line" aria-hidden="true" />}
              <span className={cn('flex-1', i <= props.index ? 'text-ink' : 'text-muted')}>{td(`shop.step.${d.id}`)}</span>
              <span className="shrink-0 font-mono text-xs text-muted">{week(dayOf(i))}</span>
            </li>
          ))}
        </ol>
        {!props.playing && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={props.onNext} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-strong">
              {t('shop.ui.nextStep')}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={props.onSkip} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink hover:bg-raised">
              <SkipForward className="h-4 w-4" aria-hidden="true" />
              {t('shop.ui.skip')}
            </button>
          </div>
        )}
      </div>
      <div>
        <MiniMap shipped={reached('shipped')} />
        <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('shop.ui.devicesTitle')}</h3>
        <ul className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {placed.map((r, i) => {
            const installed = reached('racked');
            const online = reached('online');
            const d = INDEX.devices.get(r.device!)!;
            return (
              <li
                key={r.asset}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-all duration-500',
                  !installed && 'invisible opacity-0',
                  installed && !online && 'border-dashed border-line bg-raised text-muted grayscale',
                  online && 'border-ok bg-ok-soft text-ink',
                )}
                style={{ transitionDelay: online ? `${i * 60}ms` : '0ms' }}
              >
                <RoleIcon icon={INDEX.roles.get(d.role)?.icon} className={cn('h-4 w-4 shrink-0', online ? 'text-ok' : 'text-muted')} />
                <span className="truncate font-mono">{d.name}</span>
                <span className="sr-only">{online ? t('shop.ui.online') : t('shop.ui.installed')}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 flex gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-3 w-3 rounded border border-dashed border-muted bg-raised" aria-hidden="true" />
            {t('shop.ui.installed')}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-3 w-3 rounded border border-ok bg-ok-soft" aria-hidden="true" />
            {t('shop.ui.online')}
          </span>
        </p>
      </div>
    </div>
  );
}

function ResultStep({ cart, input, late }: { cart: Cart; input: BomInput; late: Array<{ sku: string; readyDay: number; lateDays: number }> }) {
  const { t, td } = useI18n();
  const { name } = useCatalogNames();
  const rows = useMemo(() => inventory(CATALOG, cart, INDEX, PLAYBOOK.site, input), [cart, input]);
  const th = 'px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted whitespace-nowrap';
  const tdc = 'px-2 py-1.5 align-top whitespace-nowrap';
  return (
    <div className="space-y-4">
      {late.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-ok-soft p-3 text-sm font-medium text-ink">
          <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden="true" />
          {t('shop.ui.onTime')}
        </p>
      ) : (
        <ul className="space-y-2">
          {late.map((a) => {
            const it = CATALOG.items.find((i) => i.sku === a.sku)!;
            return (
              <li key={a.sku} className="rounded-xl border border-warn bg-warn-soft p-3 text-sm text-ink">
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                  {a.readyDay > 0 ? t('shop.ui.lateAfter', { item: name(it), days: a.readyDay }) : t('shop.ui.lateBefore', { item: name(it), days: a.lateDays })}
                </p>
                <p className="mt-1 pl-6 text-muted">{it.hqStock ? t('shop.ui.workaroundStock') : t('shop.ui.workaroundNone')}</p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-muted">{t('shop.ui.ticked')}</p>

      <div>
        <h3 className="text-sm font-semibold text-ink">{t('shop.ui.inventoryTitle')}</h3>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line">
                {(['device', 'model', 'serial', 'asset', 'room', 'vlan', 'ip', 'warranty'] as const).map((c) => (
                  <th key={c} className={th}>
                    {t(`shop.ui.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink">
              {rows.map((r) => {
                const it = CATALOG.items.find((i) => i.sku === r.sku)!;
                const zone = r.zone ? INDEX.zones.get(r.zone) : undefined;
                return (
                  <tr key={r.asset}>
                    <td className={tdc}>
                      <span className="font-mono text-xs">{r.hostname ?? '—'}</span>
                      <span className="block text-xs text-muted">
                        {name(it)}
                        {!r.device && ` · ${r.spare ? t('shop.ui.spare') : t('shop.ui.extra')}`}
                      </span>
                    </td>
                    <td className={cn(tdc, 'font-mono text-xs')}>{r.model}</td>
                    <td className={cn(tdc, 'font-mono text-xs')}>{r.serial}</td>
                    <td className={cn(tdc, 'font-mono text-xs')}>{r.asset}</td>
                    <td className={cn(tdc, 'text-xs')}>{zone ? zoneLabel(td, zone) : '—'}</td>
                    <td className={cn(tdc, 'text-xs')}>{r.vlan ?? '—'}</td>
                    <td className={cn(tdc, 'font-mono text-xs')}>{r.ip ?? (r.dhcp ? t('shop.ui.dhcp') : '—')}</td>
                    <td className={cn(tdc, 'text-xs')}>{r.warrantyMonths ? t('shop.ui.months', { n: r.warrantyMonths }) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
