import { ChangeDetectionStrategy, Component, ElementRef, input, model, viewChild } from '@angular/core';

import { Frame } from './receipt-image';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** The frame never gets smaller than this share of the photo in either direction. */
const MIN_SIZE = 0.08;

/**
 * A photo with a frame around the receipt. Drag a corner (or focus it and use the arrow keys) to
 * leave out the table or bedspread around the receipt: the reader then only looks inside.
 */
@Component({
  selector: 'app-receipt-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame-box" #box>
      <img [src]="src()" [alt]="label()" draggable="false">
      @if (frame(); as f) {
        <div class="frame-rect"
             [style.left.%]="f.left * 100" [style.top.%]="f.top * 100"
             [style.width.%]="(f.right - f.left) * 100" [style.height.%]="(f.bottom - f.top) * 100">
          @for (corner of corners; track corner) {
            <button type="button" [class]="'frame-handle ' + corner"
                    [attr.aria-label]="'Move the ' + corner.replace('-', ' ') + ' corner of the frame'"
                    (pointerdown)="grab($event, corner)" (keydown)="nudge($event, corner)"></button>
          }
        </div>
      } @else {
        <span class="frame-finding">Finding the receipt…</span>
      }
    </div>
  `,
})
export class ReceiptFrameComponent {
  readonly src = input.required<string>();
  readonly label = input('Receipt photo');
  readonly frame = model<Frame | null>(null);

  protected readonly corners = CORNERS;
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  protected grab(event: PointerEvent, corner: Corner): void {
    event.preventDefault();
    const handle = event.target as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const rect = this.box().nativeElement.getBoundingClientRect();
      this.moveCorner(corner, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    };
    const done = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', done);
      handle.removeEventListener('pointercancel', done);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', done);
    handle.addEventListener('pointercancel', done);
  }

  protected nudge(event: KeyboardEvent, corner: Corner): void {
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const d = delta[event.key];
    const f = this.frame();
    if (!d || !f) return;
    event.preventDefault();
    const x = corner.endsWith('left') ? f.left : f.right;
    const y = corner.startsWith('top') ? f.top : f.bottom;
    this.moveCorner(corner, x + d[0], y + d[1]);
  }

  private moveCorner(corner: Corner, x: number, y: number): void {
    const f = this.frame();
    if (!f) return;
    const next = { ...f };
    if (corner.endsWith('left')) next.left = clamp(x, 0, f.right - MIN_SIZE);
    else next.right = clamp(x, f.left + MIN_SIZE, 1);
    if (corner.startsWith('top')) next.top = clamp(y, 0, f.bottom - MIN_SIZE);
    else next.bottom = clamp(y, f.top + MIN_SIZE, 1);
    this.frame.set(next);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
