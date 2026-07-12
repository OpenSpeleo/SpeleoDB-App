import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

interface ReleaseE2EFiles {
  classification: string;
  workflow: string;
  flow: string;
  runner: string;
  installer: string;
  protocol: string;
}

describe("cross-platform release E2E workflow contract", () => {
  let files: ReleaseE2EFiles;

  beforeAll(async () => {
    const [workflow, flows, runner, installer, protocol, classification] =
      await Promise.all([
        readFile(".github/workflows/release-e2e.yml", "utf8"),
        Promise.all([
          readFile(".maestro/flows/01-bootstrap.yaml", "utf8"),
          readFile(".maestro/flows/02-create-pending.yaml", "utf8"),
          readFile(".maestro/flows/03-replay-cleanup.yaml", "utf8"),
          readFile(".maestro/flows/04-logout-purge.yaml", "utf8"),
        ]),
        readFile("scripts/run-release-e2e.sh", "utf8"),
        readFile("scripts/install-maestro-ci.sh", "utf8"),
        readFile("docs/release-device-evidence.md", "utf8"),
        readFile("quality/file-classification.json", "utf8"),
      ]);
    files = {
      workflow,
      flow: flows.join("\n"),
      runner,
      installer,
      protocol,
      classification,
    };
  });

  it("defines opt-in credential-safe Android 24/33/36 and iOS minimum/latest lanes", () => {
    expect(files.workflow).toContain("workflow_dispatch:");
    expect(files.workflow).not.toMatch(/^\s*(push|pull_request):/m);
    expect(files.workflow).toContain("permissions:\n  contents: read");
    expect(files.workflow).toContain("api-level: [24, 33, 36]");
    expect(files.workflow).toContain("lane: [minimum, latest]");
    expect(files.workflow).toContain(
      "SPELEODB_E2E_OAUTH_TOKEN: ${{ secrets.SPELEODB_E2E_OAUTH_TOKEN }}",
    );
    expect(files.workflow).toContain(
      "SPELEODB_E2E_INSTANCE_URL: ${{ secrets.SPELEODB_E2E_INSTANCE_URL }}",
    );
    expect(files.workflow).toContain(
      "SPELEODB_E2E_PROJECT_NAME: ${{ vars.SPELEODB_E2E_PROJECT_NAME }}",
    );
    expect(files.workflow).toContain("max-parallel: 1");
    expect(files.workflow).toContain("cancel-in-progress: false");
  });

  it("pins the emulator action and verifies the pinned Maestro CLI archive", () => {
    expect(files.workflow).toContain(
      "reactivecircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d",
    );
    expect(files.installer).toContain('MAESTRO_VERSION="2.4.0"');
    expect(files.installer).toContain(
      'MAESTRO_SHA256="aea22ce67ab6718997ec990c58652ede0c2be8f10ac4799039ca3dce3390d634"',
    );
    expect(files.installer).toMatch(/shasum -a 256 -c|sha256sum -c/);
    const actionReferences = Array.from(
      files.workflow.matchAll(/uses:\s+[^@\s]+@([^\s]+)/g),
      (match) => match[1],
    );
    expect(actionReferences.length).toBeGreaterThan(0);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[0-9a-f]{40}$/);
    }
    const classification = JSON.parse(files.classification) as {
      classifications: Array<{ id: string; patterns: string[] }>;
    };
    expect(
      classification.classifications.find(
        ({ id }) => id === "build-and-quality-tooling",
      )?.patterns,
    ).toContain("^\\.maestro/");
  });

  it("drives login, cached relaunch, navigation, durable replay, cleanup, and logout purge", () => {
    expect(files.flow).toContain("${SPELEODB_E2E_OAUTH_TOKEN}");
    expect(files.flow).toContain("${SPELEODB_E2E_INSTANCE_URL}");
    expect(files.flow).toContain("${SPELEODB_E2E_LANDMARK_NAME}");
    expect(files.flow).toContain("${SPELEODB_E2E_PROJECT_NAME}");
    expect(files.flow).not.toMatch(/[A-Fa-f0-9]{40}/);
    for (const marker of [
      "Fresh-install token login",
      "Cached relaunch",
      "Map and GPS navigation",
      "Create durable pending operation",
      "Replay and remove server fixture",
      "Pending-operation logout acknowledgement",
      "Post-logout relaunch remains signed out",
    ]) {
      expect(files.flow).toContain(marker);
    }
    expect(files.runner).toContain("set_network offline");
    expect(files.runner).toContain("set_network online");
    expect(files.runner).toMatch(
      /cleanup\(\)[\s\S]*restore_network[\s\S]*rm -rf/,
    );
    expect(files.runner).toContain("trap cleanup EXIT");
    expect(files.runner).toContain(
      '--test-output-dir "${REPORT_DIR}/artifacts"',
    );
    expect(files.runner).toContain('--debug-output "${REPORT_DIR}/debug"');
    expect(files.runner).not.toMatch(/set -x/);
  });

  it("keeps physical-only risks explicit and evidence-bearing", () => {
    for (const protocol of [
      "Background and lock-screen GPS delivery",
      "Heading orientation and compass cone",
      "Android notification denial",
      "Storage pressure and offline-map replacement",
      "WebView rendering and cached-map p95",
    ]) {
      expect(files.protocol).toContain(protocol);
    }
    for (const field of [
      "Device model",
      "OS version",
      "Build identifier",
      "Result",
      "Evidence",
    ]) {
      expect(files.protocol).toContain(field);
    }
    expect(files.protocol).toContain(
      "A compile, emulator, or simulator result is not physical-device evidence.",
    );
  });
});
