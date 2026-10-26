import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Toasts } from './core/toast.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    <router-outlet />
    @if (toasts.current(); as toast) {
      <div class="toast" role="status" aria-live="polite">
        <span>{{ toast.message }}</span>
        @if (toast.undo) {
          <button type="button" (click)="undo(toast.undo)">Undo</button>
        }
      </div>
    }
  `,
})
export class App {
  protected readonly toasts = inject(Toasts);

  protected undo(action: () => void): void {
    this.toasts.dismiss();
    action();
  }
}
