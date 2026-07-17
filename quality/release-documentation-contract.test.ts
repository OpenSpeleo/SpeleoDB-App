import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

interface ReleaseDocuments {
  deepLinking: string;
  gpsChecklist: string;
  gpsRecording: string;
  logout: string;
  offlineQueue: string;
}

function markdownSection(document: string, heading: string): string {
  const start = document.indexOf(`${heading}\n`);
  if (start < 0) throw new Error(`Missing documentation heading: ${heading}`);
  const content = document.slice(start + heading.length + 1);
  const nextHeading = content.search(/\n#{1,6} /);
  return nextHeading < 0 ? content : content.slice(0, nextHeading);
}

function normalizedMarkdown(document: string): string {
  return document.replace(/\s+/g, " ");
}

describe("release documentation behavior contracts", () => {
  let documents: ReleaseDocuments;

  beforeAll(async () => {
    const [deepLinking, gpsChecklist, gpsRecording, logout, offlineQueue] =
      await Promise.all([
        readFile("docs/deep-linking.md", "utf8"),
        readFile("GPS_NATIVE_RELEASE_CHECKLIST.md", "utf8"),
        readFile("docs/gps-recording-coordination.md", "utf8"),
        readFile("docs/logout-behavior.md", "utf8"),
        readFile("docs/offline-op-queue.md", "utf8"),
      ]);
    documents = {
      deepLinking,
      gpsChecklist,
      gpsRecording,
      logout,
      offlineQueue,
    };
  });

  it("requires explicit Pending-page replay after reconnect", () => {
    const offlineUpload = markdownSection(
      documents.gpsChecklist,
      "### Offline Upload Replay",
    );
    expect(offlineUpload).toMatch(
      /Reconnect alone\s+must not replay or remove the pending operation\./,
    );
    expect(offlineUpload).toContain(
      "Open Pending and tap Sync for the row or Sync Now.",
    );
    expect(offlineUpload).not.toContain(
      "pending GPS upload drains automatically",
    );
    expect(documents.offlineQueue).toMatch(
      /does \*\*not\*\* auto-drain the\s+queue/,
    );
  });

  it("documents notification denial as non-blocking for Android recording", () => {
    const notificationDenial = markdownSection(
      documents.gpsChecklist,
      "### Notification Permission Denial",
    );
    expect(normalizedMarkdown(notificationDenial)).toContain(
      "Recording starts and continues to accept points.",
    );
    expect(normalizedMarkdown(notificationDenial)).toContain(
      "The foreground-service notification may be hidden while permission is denied.",
    );
    expect(notificationDenial).not.toContain("Recording does not start.");
  });

  it("documents privacy-preserving deep-link diagnostics", () => {
    expect(documents.deepLinking).toMatch(
      /writes only the fixed event label\s+`\[DeepLink\] URL received\.`/,
    );
    expect(normalizedMarkdown(documents.deepLinking)).toMatch(
      /never writes the URL value or its query parameters/,
    );
    expect(documents.deepLinking).not.toContain("currently logs the URL");
  });

  it("keeps destructive logout and durable GPS-save guarantees explicit", () => {
    expect(documents.logout).toMatch(
      /offline operation will be permanently deleted[\s\S]*checks the loss acknowledgement/,
    );
    expect(documents.logout).toMatch(
      /forced logout after `401`\/`403` remains non-interactive/,
    );
    expect(documents.gpsRecording).toMatch(
      /leaves the watcher stopped in `paused`, and retains the complete\s+point buffer for a deterministic retry/,
    );
  });
});
