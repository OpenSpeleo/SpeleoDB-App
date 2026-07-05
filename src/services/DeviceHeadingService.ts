import { CapgoCompass } from '@capgo/capacitor-compass';
import type { HeadingChangeEvent, ListeningOptions } from '@capgo/capacitor-compass';
import { Capacitor } from '@capacitor/core';
import { GPS } from '../constants';
import { normalizeHeading } from '../utils/userLocation';

export interface HeadingListenerHandle {
  remove(): Promise<void>;
}

export interface HeadingPlugin {
  addListener(
    eventName: 'headingChange',
    listener: (event: HeadingChangeEvent) => void,
  ): Promise<HeadingListenerHandle>;
  startListening(options?: ListeningOptions): Promise<void>;
  stopListening(): Promise<void>;
}

export interface HeadingProvider {
  subscribe(listener: (heading: number | null) => void): () => void;
}

const LISTENING_OPTIONS: ListeningOptions = {
  minInterval: GPS.HEADING_MIN_INTERVAL_MS,
  minHeadingChange: GPS.HEADING_MIN_CHANGE_DEGREES,
};

/** Owns the one process-wide native compass subscription for all UI consumers. */
export class DeviceHeadingService implements HeadingProvider {
  private readonly listeners = new Set<(heading: number | null) => void>();
  private nativeHandle: HeadingListenerHandle | null = null;
  private transition: Promise<void> = Promise.resolve();
  private heading: number | null = null;

  constructor(
    private readonly plugin: HeadingPlugin = CapgoCompass,
    private readonly isNativePlatform: () => boolean = () => Capacitor.isNativePlatform(),
  ) {}

  subscribe(listener: (heading: number | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.heading);
    this.queueReconcile();

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.heading = null;
      this.queueReconcile();
    };
  }

  private queueReconcile(): void {
    this.transition = this.transition
      .then(() => this.reconcile())
      .catch(() => {
        this.publish(null);
      });
  }

  private async reconcile(): Promise<void> {
    const shouldListen = this.listeners.size > 0 && this.isNativePlatform();
    if (shouldListen && !this.nativeHandle) {
      await this.startNativeListener();
      return;
    }
    if (!shouldListen && this.nativeHandle) await this.stopNativeListener();
  }

  private async startNativeListener(): Promise<void> {
    let handle: HeadingListenerHandle | null = null;
    try {
      handle = await this.plugin.addListener('headingChange', ({ value }) => {
        const heading = normalizeHeading(value);
        if (heading !== null) this.publish(heading);
      });
      if (this.listeners.size === 0 || !this.isNativePlatform()) {
        await handle.remove().catch(() => {});
        return;
      }
      await this.plugin.startListening(LISTENING_OPTIONS);
      this.nativeHandle = handle;
    } catch {
      await handle?.remove().catch(() => {});
      await this.plugin.stopListening().catch(() => {});
      this.publish(null);
    }
  }

  private async stopNativeListener(): Promise<void> {
    const handle = this.nativeHandle;
    this.nativeHandle = null;
    this.heading = null;
    await this.plugin.stopListening().catch(() => {});
    await handle?.remove().catch(() => {});
  }

  private publish(heading: number | null): void {
    this.heading = heading;
    for (const listener of this.listeners) listener(heading);
  }
}

export const deviceHeadingService = new DeviceHeadingService();
