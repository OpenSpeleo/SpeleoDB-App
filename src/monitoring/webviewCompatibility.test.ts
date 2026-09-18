import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('requires iOS 16.4 for every native configuration and the web bundle', async () => {
    const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
    const deploymentTargets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g)]
      .map((match) => match[1]);
    expect(deploymentTargets.length).toBeGreaterThan(0);
    expect(new Set(deploymentTargets)).toEqual(new Set(['16.4']));

    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' });
    expect(loaded?.config.build?.target).toEqual(expect.arrayContaining(['safari16.4', 'ios16.4']));
  });
});
