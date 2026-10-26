import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

/** One message at a time at the bottom of the screen, optionally with an Undo action. */
@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly current = signal<Toast | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 1;

  show(message: string, undo?: () => void): void {
    clearTimeout(this.timer);
    const toast: Toast = { id: this.nextId++, message, undo };
    this.current.set(toast);
    this.timer = setTimeout(() => {
      if (this.current()?.id === toast.id) this.current.set(null);
    }, undo ? 6000 : 3500);
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.current.set(null);
  }
}
