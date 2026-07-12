import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("trusted release ceremony documentation", () => {
  let ceremony: string;
  let ci: string;

  beforeAll(async () => {
    [ceremony, ci] = await Promise.all([
      readFile("docs/release-ceremony.md", "utf8"),
      readFile("docs/ci.md", "utf8"),
    ]);
  });

  it("defines one monotonic Android/iOS version source and clean candidate", () => {
    expect(ceremony).toContain("android/app/build.gradle");
    expect(ceremony).toContain("versionName");
    expect(ceremony).toContain("versionCode");
    expect(ceremony).toContain("MARKETING_VERSION");
    expect(ceremony).toContain("CURRENT_PROJECT_VERSION");
    expect(ceremony).toContain("must match across Android and iOS");
    expect(ceremony).toMatch(/clean, immutable candidate commit/i);
    expect(ceremony).toMatch(
      /never reuse.*versionCode.*CURRENT_PROJECT_VERSION/is,
    );
  });

  it("requires protected publisher identities and verifies produced artifacts", () => {
    for (const marker of [
      "protected secret store",
      "expected Android signing-certificate SHA-256 fingerprint",
      "expected Apple Team ID",
      "apksigner verify --verbose --print-certs",
      "codesign --verify --deep --strict",
      "embedded.mobileprovision",
    ]) {
      expect(ceremony).toContain(marker);
    }
    expect(ceremony).toMatch(
      /Disposable CI\s+signatures are compilation evidence only/,
    );
  });

  it("gates distribution on installation, stores, symbols, hashes, and approval", () => {
    for (const marker of [
      "Clean installation",
      "Upgrade installation",
      "Google Play Console",
      "Xcode Organizer",
      "mapping.txt",
      ".dSYM",
      "SHA256SUMS",
      "independent release approver",
      "rollback",
    ]) {
      expect(ceremony).toContain(marker);
    }
    expect(ceremony).toMatch(/artifact.*source commit/is);
    expect(ceremony).toMatch(/stop.*staged rollout/is);
  });

  it("preserves the no-publish authorization boundary", () => {
    expect(ceremony).toContain(
      "This repository plan does not authorize publishing",
    );
    expect(ceremony).toMatch(
      /No tag, GitHub release,\s+store upload, or rollout/,
    );
    expect(ci).toContain("smoke artifacts must never be distributed to users");
    expect(ci).toContain("docs/release-ceremony.md");
  });
});
