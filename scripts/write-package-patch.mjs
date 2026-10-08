import { mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Replace the installed file without mutating Bun's hardlinked cache copy. */
export function writePackagePatch(filePath, contents) {
  const temporary = mkdtempSync(path.join(path.dirname(filePath), '.speleodb-patch-'));
  try {
    const output = path.join(temporary, path.basename(filePath));
    writeFileSync(output, contents, { encoding: 'utf8', mode: statSync(filePath).mode });
    renameSync(output, filePath);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
