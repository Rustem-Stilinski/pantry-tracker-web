import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, output, signal, viewChild,
} from '@angular/core';

import { ReadConfirmer } from '../core/barcode';
import { Detector, FoundBarcode, barcodeDetector, pickBarcode, readPhoto } from './barcode-reader';

type CameraState = 'starting' | 'scanning' | 'blocked' | 'unavailable' | 'failed';

/** Back camera, at a resolution where barcode bars are sharp but each frame is quick to read. */
const CAMERA: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
};

/** Live camera view that reads a product barcode, with a photo fallback. Emits once, then stops the camera. */
@Component({
  selector: 'app-barcode-scanner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="viewfinder" [class.live]="state() === 'scanning'">
      <video #video playsinline muted aria-hidden="true"></video>
      @switch (state()) {
        @case ('scanning') {
          <div class="aim" aria-hidden="true"></div>
          <p class="vf-hint" role="status">Point the camera at the barcode</p>
        }
        @case ('starting') {
          <p class="vf-msg" role="status"><span class="spinner" aria-hidden="true"></span>Starting the camera…</p>
        }
        @default {
          <div class="vf-msg" role="alert">
            <span>{{ problem() }}</span>
            @if (state() !== 'unavailable') {
              <button type="button" class="secondary btn-small" (click)="start()">Try the camera again</button>
            }
          </div>
        }
      }
    </div>
    <label class="photo-pick">
      <input type="file" accept="image/*" (change)="fromPhoto($event)" [disabled]="readingPhoto()">
      <span class="link-btn">{{ readingPhoto() ? 'Reading the photo…' : 'Use a photo of the barcode instead' }}</span>
    </label>
    @if (photoMsg()) {
      <p class="form-msg" role="alert">{{ photoMsg() }}</p>
    }
  `,
  host: { class: 'scanner' },
})
export class BarcodeScanner {
  readonly detected = output<FoundBarcode>();

  protected readonly state = signal<CameraState>('starting');
  protected readonly problem = signal('');
  protected readonly photoMsg = signal('');
  protected readonly readingPhoto = signal(false);

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly confirmer = new ReadConfirmer();
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private destroyed = false;

  constructor() {
    afterNextRender(() => void this.start());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.stop();
    });
  }

  protected async start(): Promise<void> {
    this.stop();
    this.state.set('starting');
    this.problem.set('');
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail('unavailable', 'This browser can’t use the camera here. Use a photo of the barcode, or type its number.');
      return;
    }

    const [reader, camera] = await Promise.allSettled([
      barcodeDetector(),
      navigator.mediaDevices.getUserMedia(CAMERA),
    ]);
    if (this.destroyed) {
      if (camera.status === 'fulfilled') stopTracks(camera.value);
      return;
    }
    if (camera.status === 'rejected') {
      const name = (camera.reason as { name?: string } | null)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.fail('blocked', 'Camera access is off for this site. Allow the camera in your browser’s settings for this site, then try again. Or type the number below.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        this.fail('unavailable', 'No camera was found. Use a photo of the barcode, or type its number.');
      } else {
        this.fail('failed', 'The camera didn’t start. Close other apps using it, then try again.');
      }
      return;
    }
    this.stream = camera.value;
    if (reader.status === 'rejected') {
      this.stop();
      this.fail('failed', 'The barcode reader didn’t load. Check your connection, then try again.');
      return;
    }

    const video = this.video()?.nativeElement;
    if (!video) {
      this.stop();
      return;
    }
    video.muted = true;
    video.srcObject = this.stream;
    try {
      await video.play();
    } catch {
      this.stop();
      this.fail('failed', 'The camera is ready. Tap “Try the camera again” to start it.');
      return;
    }
    this.confirmer.reset();
    this.state.set('scanning');
    this.running = true;
    this.scanFrames(reader.value, video);
  }

  protected async fromPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoMsg.set('');
    this.readingPhoto.set(true);
    try {
      const found = await readPhoto(file);
      if (found) {
        this.finish(found);
      } else {
        this.photoMsg.set('No barcode found in that photo. Take it closer, so the barcode fills most of the picture.');
      }
    } catch {
      this.photoMsg.set('That photo couldn’t be read. Try another one, or type the number.');
    } finally {
      this.readingPhoto.set(false);
    }
  }

  /** Reads a frame about eight times a second; a code counts once two frames in a row agree. */
  private scanFrames(detector: Detector, video: HTMLVideoElement): void {
    const tick = async () => {
      if (!this.running) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const found = pickBarcode(await detector.detect(video));
          if (found && this.running && this.confirmer.read(`${found.format}:${found.code}`)) {
            this.finish(found);
            return;
          }
        } catch {
          /* a frame that can't be read; try the next one */
        }
      }
      if (this.running) this.timer = setTimeout(tick, 120);
    };
    void tick();
  }

  private finish(found: FoundBarcode): void {
    this.stop();
    // A short buzz confirms the read; browsers only allow it after the person has tapped the page.
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(40);
    this.detected.emit(found);
  }

  private fail(state: CameraState, message: string): void {
    this.state.set(state);
    this.problem.set(message);
  }

  private stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    if (this.stream) stopTracks(this.stream);
    this.stream = null;
    const video = this.video()?.nativeElement;
    if (video) video.srcObject = null;
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
