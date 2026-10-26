import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { tallyGroups } from '../core/format';

interface Stroke { x1: number; y1: number; x2: number; y2: number; }

const GROUP_WIDTH = 24;
const STROKE_GAP = 4.5;

/** Hand-counted tally marks (||||/) for how many times an item was logged. Shows up to 20 marks. */
@Component({
  selector: 'app-tally',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="tally" [attr.viewBox]="'0 0 ' + width() + ' 18'" [attr.width]="width()" height="18" aria-hidden="true">
      @for (s of strokes(); track $index) {
        <line [attr.x1]="s.x1" [attr.y1]="s.y1" [attr.x2]="s.x2" [attr.y2]="s.y2" />
      }
    </svg>
  `,
  host: { class: 'tally-host' },
})
export class Tally {
  readonly count = input.required<number>();

  readonly width = computed(() => Math.max(tallyGroups(this.count()).length * GROUP_WIDTH - 4, 4));

  readonly strokes = computed<Stroke[]>(() => {
    const strokes: Stroke[] = [];
    tallyGroups(this.count()).forEach((size, g) => {
      const x0 = g * GROUP_WIDTH + 3;
      for (let i = 0; i < Math.min(size, 4); i++) {
        const x = x0 + i * STROKE_GAP;
        strokes.push({ x1: x, y1: 2, x2: x, y2: 16 });
      }
      if (size === 5) strokes.push({ x1: x0 - 2.5, y1: 13.5, x2: x0 + 16, y2: 4.5 });
    });
    return strokes;
  });
}
