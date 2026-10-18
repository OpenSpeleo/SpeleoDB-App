import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
// These are transport implementations or external assets, never endpoint tables.
const boundaries = new Map([
  ['src/services/HttpClient.ts', 'native/browser transport and cookie-free route policy'],
  ['src/services/apiTransport.ts', 'generated API transport adapter'],
  ['src/services/SpeleoDBService.ts:downloadJSON', 'signed object-storage JSON'],
  ['src/services/TileCacheService.ts:downloadValidatedTile', 'external map tiles'],
  ['src/services/TileCacheService.ts:getCachedStyle', 'external map styles'],
  ['src/pages/dashboard/dashboardMapUtils.ts:loadImageViaFetch', 'map images'],
]);
const failures = [];
function inspect(path) {
  const name = relative(root, path).replaceAll('\\', '/');
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const allowed = (node) => {
    if (boundaries.has(name)) return true;
    for (let owner = node.parent; owner; owner = owner.parent) {
      if ((ts.isFunctionDeclaration(owner) || ts.isMethodDeclaration(owner)) && owner.name) {
        if (boundaries.has(`${name}:${owner.name.getText(source)}`)) return true;
      }
    }
    return false;
  };
  const fail = (node, message) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    failures.push(`${name}:${line + 1}: ${message}`);
  };
  const visit = (node) => {
    if (!allowed(node)) {
      if (ts.isIdentifier(node) && ['fetch', 'XMLHttpRequest', 'CapacitorHttp'].includes(node.text)) {
        fail(node, 'Network access must use a generated @speleodb/api operation or a documented external-asset boundary.');
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'request') {
        fail(node, 'Raw request calls belong in the transport boundary.');
      }
    }
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && /\/(?:api\/v\d+|_allauth)\//.test(node.text)
      && name !== 'src/services/HttpClient.ts') {
      fail(node, 'First-party endpoint paths must come from generated operations.');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(path);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|d)\.tsx?$/.test(entry.name)) inspect(path);
  }
}
walk(join(root, 'src'));
if (failures.length) {
  console.error([...new Set(failures)].join('\n'));
  process.exitCode = 1;
} else {
  console.log(`API network boundaries verified (${boundaries.size} documented transport/asset boundaries).`);
}
