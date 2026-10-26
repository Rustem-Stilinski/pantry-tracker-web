import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, signal,
} from '@angular/core';

import { PricePoint } from '../core/models';
import { unitPrice } from '../core/money';

const HEIGHT = 220;
const MARGIN = { top: 14, right: 18, bottom: 30, left: 58 };
/** Stores beyond the first three share one neutral color ("Other"); see the palette notes in styles.css. */
const MAX_STORE_COLORS = 3;

interface Dot {
  x: number;
  y: number;
  point: PricePoint;
  colorClass: string;
}

/**
 * Unit price over time: one neutral line through every purchase, dots colored by store.
 * Sized to its container (ResizeObserver) so labels stay readable on phones.
 */
@Component({
  selector: 'app-price-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (legend().length > 1) {
      <ul class="chart-legend" aria-label="Stores">
        @for (entry of legend(); track entry.name) {
          <li><span class="swatch" [class]="'swatch ' + entry.colorClass"></span>{{ entry.name }}</li>
        }
      </ul>
    }
    <div class="chart-frame">
      <svg [attr.width]="width()" [attr.height]="height" role="img" [attr.aria-label]="summary()"
           (pointermove)="hover($event)" (pointerleave)="active.set(null)">
        @for (tick of yTicks(); track tick.value) {
          <line class="grid" [attr.x1]="margin.left" [attr.x2]="width() - margin.right" [attr.y1]="tick.y" [attr.y2]="tick.y" />
          <text class="axis" [attr.x]="margin.left - 8" [attr.y]="tick.y" text-anchor="end" dominant-baseline="middle">{{ tick.label }}</text>
        }
        @for (tick of xTicks(); track tick.label) {
          <text class="axis" [attr.x]="tick.x" [attr.y]="height - 8" [attr.text-anchor]="tick.anchor">{{ tick.label }}</text>
        }
        @if (dots().length > 1) {
          <polyline class="trend" [attr.points]="linePoints()" />
        }
        @for (dot of dots(); track $index) {
          <circle class="dot" [class]="'dot ' + dot.colorClass" [attr.cx]="dot.x" [attr.cy]="dot.y"
                  [attr.r]="active() === dot ? 6.5 : 5" />
        }
      </svg>
      @if (active(); as a) {
        <div class="chart-tip" [style.left.px]="tipLeft(a)" [style.top.px]="a.y">
          <strong>{{ price(a.point.unitPrice) }}</strong>
          <span>{{ a.point.storeName }} · {{ dateFmt.format(date(a.point)) }}</span>
        </div>
      }
    </div>
  `,
  host: { class: 'price-chart' },
})
export class PriceChart {
  readonly points = input.required<PricePoint[]>();
  readonly unit = input('pcs');

  protected readonly height = HEIGHT;
  protected readonly margin = MARGIN;
  protected readonly width = signal(600);
  protected readonly active = signal<Dot | null>(null);
  protected readonly dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  private readonly shortFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

  /** Stores ordered by how often they appear; the top three get a color each. */
  private readonly storeColors = computed(() => {
    const counts = new Map<string, number>();
    for (const p of this.points()) counts.set(p.storeName, (counts.get(p.storeName) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const colors = new Map<string, string>();
    ranked.forEach((name, i) => colors.set(name, i < MAX_STORE_COLORS ? `s${i + 1}` : 's-other'));
    return colors;
  });

  protected readonly legend = computed(() => {
    const entries: { name: string; colorClass: string }[] = [];
    let hasOther = false;
    for (const [name, colorClass] of this.storeColors()) {
      if (colorClass === 's-other') hasOther = true;
      else entries.push({ name, colorClass });
    }
    if (hasOther) entries.push({ name: 'Other stores', colorClass: 's-other' });
    return entries;
  });

  private readonly domain = computed(() => {
    const pts = this.points();
    const times = pts.map((p) => new Date(p.purchasedAt).getTime());
    const prices = pts.map((p) => Number(p.unitPrice));
    let tMin = Math.min(...times);
    let tMax = Math.max(...times);
    if (tMin === tMax) { tMin -= 86_400_000 * 3; tMax += 86_400_000 * 3; }
    const { lo, hi, step } = niceRange(Math.min(...prices), Math.max(...prices));
    return { tMin, tMax, lo, hi, step };
  });

  private x(t: number): number {
    const { tMin, tMax } = this.domain();
    return MARGIN.left + ((t - tMin) / (tMax - tMin)) * (this.width() - MARGIN.left - MARGIN.right);
  }

  private y(v: number): number {
    const { lo, hi } = this.domain();
    return MARGIN.top + (1 - (v - lo) / (hi - lo)) * (HEIGHT - MARGIN.top - MARGIN.bottom);
  }

  protected readonly dots = computed<Dot[]>(() => {
    this.width();
    const colors = this.storeColors();
    return this.points().map((point) => ({
      x: this.x(new Date(point.purchasedAt).getTime()),
      y: this.y(Number(point.unitPrice)),
      point,
      colorClass: colors.get(point.storeName) ?? 's-other',
    }));
  });

  protected readonly linePoints = computed(() => this.dots().map((d) => `${d.x},${d.y}`).join(' '));

  protected readonly yTicks = computed(() => {
    this.width();
    const { lo, hi, step } = this.domain();
    const ticks: { value: number; y: number; label: string }[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) {
      const value = Math.round(v * 1000) / 1000;
      ticks.push({ value, y: this.y(value), label: `$${value.toFixed(step < 0.1 ? 2 : step < 1 ? 2 : 0)}` });
    }
    return ticks;
  });

  protected readonly xTicks = computed(() => {
    const { tMin, tMax } = this.domain();
    const pts = this.points();
    if (pts.length === 1) {
      const t = new Date(pts[0].purchasedAt);
      return [{ x: this.x(t.getTime()), label: this.shortFmt.format(t), anchor: 'middle' }];
    }
    return [
      { x: this.x(tMin), label: this.shortFmt.format(new Date(tMin)), anchor: 'start' },
      { x: this.x(tMax), label: this.shortFmt.format(new Date(tMax)), anchor: 'end' },
    ];
  });

  protected readonly summary = computed(() => {
    const pts = this.points();
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `Price per ${this.unit() === 'pcs' ? 'item' : this.unit()} over time: ${pts.length} purchases, from ` +
      `${this.price(first.unitPrice)} to ${this.price(last.unitPrice)}.`;
  });

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const observer = new ResizeObserver(([entry]) => this.width.set(Math.max(280, Math.floor(entry.contentRect.width))));
    observer.observe(host);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  protected price(value: number): string {
    return unitPrice(value, this.unit());
  }

  protected date(p: PricePoint): Date {
    return new Date(p.purchasedAt);
  }

  /** Nearest dot to the pointer, horizontally first. */
  protected hover(event: PointerEvent): void {
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let best: Dot | null = null;
    let bestDist = Infinity;
    for (const dot of this.dots()) {
      const dist = Math.abs(dot.x - px) * 2 + Math.abs(dot.y - py) * 0.5;
      if (dist < bestDist) { best = dot; bestDist = dist; }
    }
    this.active.set(best);
  }

  protected tipLeft(dot: Dot): number {
    return Math.min(Math.max(dot.x, 80), this.width() - 80);
  }
}

/** A tidy y range with 3–5 round ticks around the data. */
export function niceRange(min: number, max: number): { lo: number; hi: number; step: number } {
  const span = Math.max(max - min, max * 0.2, 0.05);
  const rough = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const lo = Math.max(0, Math.floor((min - span * 0.15) / step) * step);
  const hi = Math.ceil((max + span * 0.15) / step) * step;
  return { lo, hi: hi === lo ? lo + step : hi, step };
}
