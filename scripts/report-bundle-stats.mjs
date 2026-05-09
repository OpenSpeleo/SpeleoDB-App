import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

const statsPath = resolve(process.cwd(), 'dist', 'bundle-stats.json')
const rawStats = await readFile(statsPath, 'utf8')
const stats = JSON.parse(rawStats)

console.log(`[bundle] legacy plugin: ${stats.legacyEnabled ? 'enabled' : 'disabled'}`)
if (stats.mainEntry) {
  console.log(`[bundle] main entry: ${stats.mainEntry.fileName} (${formatBytes(stats.mainEntry.bytes)})`)
}
console.log(`[bundle] initial JS graph: ${formatBytes(stats.initialJsBytes)}`)
if (stats.largestLazyChunk) {
  console.log(
    `[bundle] largest lazy chunk: ${stats.largestLazyChunk.fileName} (${formatBytes(stats.largestLazyChunk.bytes)})`,
  )
}
