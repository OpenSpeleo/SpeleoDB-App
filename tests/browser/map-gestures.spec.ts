import { expect, test } from '@playwright/test';
import { fixture } from './fixtures/app';
import {
  anchorGesture, assertGestureCameraReleased, dragGesturePath, gestureCanvasPoint,
  installGestureSources, observeGestureAnchor, observeGestureMap, setGestureCamera,
  refreshGestureSource, pinchGesture, touchInput, waitForGestureEnd, waitForGestureMap, waitForGestureSources, wheelToGestureZoom,
  GESTURE_DIRECTIONS, GESTURE_AXIS_TOLERANCE,
} from '@speleodb/map-viewer/testing/gestures';
import type { Page } from '@playwright/test';

async function prepareGestureMap(page: Page, withData: boolean) {
  await waitForGestureMap(page);
  await setGestureCamera(page, [-87.5, 20.1], 12.3);
  if (withData) await installGestureSources(page, { center: [-87.5, 20.1], sourceCount: 1, featuresPerSource: 12_000 });
  return gestureCanvasPoint(page);
}

async function expectGestureOffset(page: Page, start: { x: number; y: number }, dx: number, dy: number) {
  const state = await observeGestureAnchor(page);
  expect(Math.abs(state.point.x - start.x - dx), 'horizontal anchor error in CSS pixels').toBeLessThan(GESTURE_AXIS_TOLERANCE);
  expect(Math.abs(state.point.y - start.y - dy), 'vertical anchor error in CSS pixels').toBeLessThan(GESTURE_AXIS_TOLERANCE);
  expect(state.bearing).toBeCloseTo(0, 6);
  expect(state.pitch).toBeCloseTo(0, 6);
}

test.beforeEach(async ({ page }) => {
  await fixture(page);
  await observeGestureMap(page);
  await page.goto('/dashboard');
});

test.describe('desktop projection transitions', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
  for (const withData of [false, true]) {
    test(`wheel crossing preserves drag direction${withData ? ' during GeoJSON replacement' : ''}`, async ({ page }) => {
      // Eight drags / 96 rendered input samples plus wheel animations exceed
      // Playwright's 30-second default on Chromium's software WebGL renderer.
      test.setTimeout(90_000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const point = await prepareGestureMap(page, withData);
      for (const targetZoom of [11.6, 12.2]) {
        await wheelToGestureZoom(page, point, targetZoom);
        // Repeated independent drags also catch state retained after moveend.
        for (const delta of GESTURE_DIRECTIONS) {
          const result = await dragGesturePath(page, point, delta, withData ? step => refreshGestureSource(page, step) : undefined);
          expect(result.maximumError).toBeLessThan(GESTURE_AXIS_TOLERANCE);
          for (const sample of result.path) {
            expect(sample.bearing).toBeCloseTo(0, 6);
            expect(sample.pitch).toBeCloseTo(0, 6);
          }
          await assertGestureCameraReleased(page);
        }
      }
      if (withData) await waitForGestureSources(page);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('touch projection transitions', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('retains the remaining contact when pinch motion finishes before its next move', async ({ page, browserName }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const point = await prepareGestureMap(page, true);
    const touch = await touchInput(page, browserName);
    try {
      await pinchGesture(touch, point);
      await touch.end([2]);
      // Let the actual camera finish while a finger is still held. A native
      // contact must survive this pause without a new touchstart or camera reset.
      await waitForGestureEnd(page);
      expect(await page.evaluate(() => window.__speleoGesture.map.dragPan.isActive())).toBe(true);
      const { point: start } = await anchorGesture(page, { x: point.x - 50, y: point.y });
      for (let step = 1; step <= 12; step++) {
        await refreshGestureSource(page, step);
        await touch.move([{ id: 1, x: point.x - 50, y: point.y + 4 * step }]);
        await expectGestureOffset(page, start, 0, step * 4);
      }
      await touch.end([1]);
      await assertGestureCameraReleased(page);
      await waitForGestureSources(page);
    } finally { await touch.dispose(); }
  });
  for (const handoff of [false, true]) {
    for (const reducedMotion of ['reduce', 'no-preference'] as const) {
      test(`pinch then ${handoff ? 'one-finger handoff' : 'two-finger translation'} preserves direction (${reducedMotion})`, async ({ page, browserName }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.emulateMedia({ reducedMotion });
        const point = await prepareGestureMap(page, true);
        const touch = await touchInput(page, browserName);
        try {
          await pinchGesture(touch, point);
          const zoom = await page.evaluate(() => window.__speleoGesture.map.getZoom());
          expect(zoom).toBeGreaterThan(11);
          expect(zoom).toBeLessThan(12);
          if (handoff) await touch.end([2]);
          const { point: start } = await anchorGesture(page, { x: point.x - 50, y: point.y });
          for (let step = 1; step <= 12; step++) {
            await refreshGestureSource(page, step);
            const contacts = [{ id: 1, x: point.x - 50, y: point.y + 4 * step }];
            if (!handoff) contacts.push({ id: 2, x: point.x + 50, y: point.y + 4 * step });
            await touch.move(contacts);
            await expectGestureOffset(page, start, 0, step * 4);
          }
          await touch.end(handoff ? [1] : [1, 2]);
          // Wait for any real inertia, without issuing a camera reset that could mask stale state.
          await assertGestureCameraReleased(page);
          await touch.start([{ id: 3, ...point }]);
          // Chromium's native touch delivery has a drag-recognition slop. Start
          // the new drag before measuring 4px samples; do not mistake that
          // platform threshold for a projection error on an active gesture.
          await touch.move([{ id: 3, x: point.x, y: point.y - 24 }]);
          expect(await page.evaluate(() => window.__speleoGesture.map.isMoving())).toBe(true);
          const { point: next } = await anchorGesture(page, { x: point.x, y: point.y - 24 });
          for (let step = 1; step <= 12; step++) {
            await touch.move([{ id: 3, x: point.x, y: point.y - 24 - 4 * step }]);
            await expectGestureOffset(page, next, 0, -step * 4);
          }
          await touch.end([3]);
          await assertGestureCameraReleased(page);
          await waitForGestureSources(page);
          expect(errors).toEqual([]);
        } finally { await touch.dispose(); }
      });
    }
  }
});
