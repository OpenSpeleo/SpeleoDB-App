import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface ManifestIcon {
  src: string;
  type: string;
  sizes: string;
  purpose?: string;
}

interface WebManifest {
  short_name: string;
  name: string;
  icons: ManifestIcon[];
  theme_color: string;
  background_color: string;
}

function localPath(outDir: string, reference: string): string | null {
  const url = new URL(reference, 'https://speleodb.invalid/');
  if (url.origin !== 'https://speleodb.invalid') return null;
  return path.join(outDir, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
}

async function expectBuiltReference(outDir: string, reference: string): Promise<void> {
  const outputPath = localPath(outDir, reference);
  if (!outputPath) return;
  await expect(stat(outputPath)).resolves.toMatchObject({ size: expect.any(Number) });
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('built SpeleoDB PWA metadata', () => {
  let outDir: string;
  let document: Document;
  let manifest: WebManifest;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'speleodb-pwa-'));
    const previousBundleBudget = process.env.VITE_ENFORCE_BUNDLE_BUDGET;
    process.env.VITE_ENFORCE_BUNDLE_BUDGET = 'false';
    try {
      // Vitest instruments modules loaded by this in-process build, inflating
      // chunks. The normal standalone build owns bundle-budget verification;
      // this build owns emitted metadata and asset resolution.
      await build({
        configFile: path.resolve('vite.config.ts'),
        mode: 'production',
        logLevel: 'silent',
        build: {
          outDir,
          emptyOutDir: true,
          // This metadata-only build does not benchmark plugins. Rolldown's
          // load-sensitive advisory is nondeterministic and bypasses Vite's
          // silent logger; standalone production builds retain the check.
          rolldownOptions: { checks: { pluginTimings: false } },
        },
      });
    } finally {
      if (previousBundleBudget === undefined) {
        delete process.env.VITE_ENFORCE_BUNDLE_BUDGET;
      } else {
        process.env.VITE_ENFORCE_BUNDLE_BUDGET = previousBundleBudget;
      }
    }
    const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
    document = new DOMParser().parseFromString(html, 'text/html');
    const manifestHref = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    )?.getAttribute('href');
    expect(manifestHref).toBeTruthy();
    const manifestPath = localPath(outDir, manifestHref as string) as string;
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as WebManifest;
  }, 30_000);

  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it('brands the built document and manifest as SpeleoDB', () => {
    expect(document.title).toBe('SpeleoDB');
    expect(document.querySelector<HTMLMetaElement>(
      'meta[name="apple-mobile-web-app-title"]',
    )?.content).toBe('SpeleoDB');
    expect(manifest.name).toBe('SpeleoDB');
    expect(manifest.short_name).toBe('SpeleoDB');
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content)
      .toBe(manifest.theme_color);
    expect(manifest.background_color).toBe('#0f182a');
  });

  it('ships every local built HTML and manifest asset with truthful icon metadata', async () => {
    const references = [
      ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[href]'))
        .map((element) => element.getAttribute('href') as string),
      ...Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
        .map((element) => element.getAttribute('src') as string),
    ];
    await Promise.all(references.map((reference) => expectBuiltReference(outDir, reference)));

    const htmlIcons = Array.from(document.querySelectorAll<HTMLLinkElement>(
      'link[rel*="icon"]',
    ));
    for (const icon of htmlIcons) {
      const reference = icon.getAttribute('href') as string;
      const sizes = icon.getAttribute('sizes') as string;
      const [width, height] = sizes.split('x').map(Number);
      expect(pngDimensions(await readFile(localPath(outDir, reference) as string)))
        .toEqual({ width, height });
      if (icon.type) expect(icon.type).toBe('image/png');
    }

    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.purpose).toBe('any');
      const iconPath = localPath(outDir, icon.src) as string;
      const bytes = await readFile(iconPath);
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngDimensions(bytes)).toEqual({ width, height });
    }
  });
});
