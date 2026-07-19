import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const pluginBuildFiles = [
  "node_modules/@capacitor-community/background-geolocation/android/build.gradle",
  "node_modules/@sentry/capacitor/android/build.gradle",
] as const;

describe("Android Gradle deprecation audit", () => {
  let pluginBuildScripts: string[];
  let audit: string;

  beforeAll(async () => {
    [pluginBuildScripts, audit] = await Promise.all([
      Promise.all(pluginBuildFiles.map((file) => readFile(file, "utf8"))),
      readFile("docs/android-gradle-warnings.md", "utf8"),
    ]);
  });

  it("patches installed plugin property assignments to Gradle 10 syntax", () => {
    for (const buildScript of pluginBuildScripts) {
      expect(buildScript).not.toMatch(/^\s*namespace\s+["']/m);
      expect(buildScript).not.toMatch(/^\s*abortOnError\s+(?:true|false)\s*$/m);
      expect(buildScript).toMatch(/^\s*namespace\s*=\s*["']/m);
      expect(buildScript).toMatch(/^\s*abortOnError\s*=\s*(?:true|false)\s*$/m);
    }
  });

  it("attributes every accepted generated and third-party warning", () => {
    expect(audit).toContain(
      "android/capacitor-cordova-android-plugins/build.gradle",
    );
    expect(audit).toContain(
      "WARNING: Using flatDir should be avoided because it doesn't support any meta-data formats.",
    );
    for (const marker of [
      "SentryCapacitor.java",
      "PackageInfo.versionCode",
      "FilesystemPlugin.kt",
      "downloadFile",
      "LegacyFilesystemImplementation.kt",
      "Java type mismatch",
      "BackgroundGeolocation.java",
      "Notification.PRIORITY_HIGH",
      "LocationRequest.PRIORITY_HIGH_ACCURACY",
      "Unable to strip",
      "libsentry-android.so",
      "quality/gradle-deprecation.init.gradle",
    ]) {
      expect(audit).toContain(marker);
    }
    expect(audit).toMatch(
      /any additional Gradle warning is a release failure/i,
    );
    expect(audit).toMatch(/do not.*blanket.*upgrade/is);
  });
});
