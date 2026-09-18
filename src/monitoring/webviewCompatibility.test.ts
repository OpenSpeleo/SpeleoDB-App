import { describe, expect, it } from 'vitest';
import { loadConfigFromFile } from 'vite';
import capacitor from '../../capacitor.config';

describe('native browser support contract', () => {
  it('rejects engines below the CSS framework floor before application startup', () => {
    expect(capacitor.android?.minWebViewVersion).toBe(111);
    expect(capacitor.server?.errorPath).toBe('webview-update.html');
  });

  it('uses the same Chromium floor in the actual production build configuration', async () => {
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' });
    expect(loaded?.config.build?.target).toContain(`chrome${capacitor.android?.minWebViewVersion}`);
  });
});
