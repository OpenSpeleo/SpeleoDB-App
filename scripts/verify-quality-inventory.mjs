import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const classificationPath = path.join(repoRoot, 'quality', 'file-classification.json')
const config = JSON.parse(readFileSync(classificationPath, 'utf8'))

if (config.schemaVersion !== 1 || !Array.isArray(config.classifications)) {
  throw new Error('quality/file-classification.json has an unsupported schema')
}

const classifications = config.classifications.map((classification) => ({
  ...classification,
  patterns: classification.patterns.map((pattern) => new RegExp(pattern)),
  excludePatterns: (classification.excludePatterns ?? []).map((pattern) => new RegExp(pattern)),
}))

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean)

const matchesClassification = (file, classification) =>
  classification.patterns.some((pattern) => pattern.test(file))
  && !classification.excludePatterns.some((pattern) => pattern.test(file))

const unclassified = []
const multiplyClassified = []
const totals = new Map(classifications.map(({ id }) => [id, 0]))

for (const file of trackedFiles) {
  const matches = classifications.filter((classification) =>
    matchesClassification(file, classification),
  )

  if (matches.length === 0) {
    unclassified.push(file)
    continue
  }
  if (matches.length > 1) {
    multiplyClassified.push({ file, ids: matches.map(({ id }) => id) })
    continue
  }

  const id = matches[0].id
  totals.set(id, (totals.get(id) ?? 0) + 1)
}

if (unclassified.length > 0 || multiplyClassified.length > 0) {
  if (unclassified.length > 0) {
    console.error('Unclassified tracked files:')
    for (const file of unclassified) console.error(`  ${file}`)
  }
  if (multiplyClassified.length > 0) {
    console.error('Tracked files with multiple classifications:')
    for (const { file, ids } of multiplyClassified) {
      console.error(`  ${file}: ${ids.join(', ')}`)
    }
  }
  process.exitCode = 1
} else {
  console.log(`Quality inventory covers all ${trackedFiles.length} tracked files:`)
  for (const [id, total] of totals) console.log(`  ${id}: ${total}`)
}
