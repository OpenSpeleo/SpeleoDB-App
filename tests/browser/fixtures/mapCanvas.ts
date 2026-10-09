import type { Page } from '@playwright/test';

/** Capture real map pixels without the DOM controls covering the canvas. */
export async function captureMapCanvas(page: Page): Promise<Buffer> {
  const dataUrl = await page.locator('canvas.maplibregl-canvas').evaluate((element: HTMLCanvasElement) => {
    // The app fixture retains the WebGL drawing buffer for pixel assertions.
    // Locator screenshots include attribution, scale labels and other overlays,
    // whose antialiased text can match geometry colors on a different platform.
    const canvas = document.createElement('canvas');
    canvas.width = element.clientWidth;
    canvas.height = element.clientHeight;
    canvas.getContext('2d')!.drawImage(element, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}
