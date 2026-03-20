import { readdirSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const apiDir = join(rootDir, 'apps', 'api')
const write = process.argv.includes('--write')

const ignoredDirectories = new Set(['.git', '.idea', '.vscode', 'bin', 'node_modules'])

function collectGoFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue
      }

      files.push(...collectGoFiles(join(dir, entry.name)))
      continue
    }

    if (extname(entry.name) === '.go') {
      files.push(join(dir, entry.name))
    }
  }

  return files
}

const goFiles = collectGoFiles(apiDir).sort()

if (goFiles.length === 0) {
  console.log('No Go files found under apps/api.')
  process.exit(0)
}

const commandArgs = [write ? '-w' : '-l', ...goFiles]
const result = spawnSync('gofmt', commandArgs, {
  cwd: rootDir,
  encoding: 'utf8',
  stdio: write ? 'inherit' : ['ignore', 'pipe', 'pipe'],
})

if (result.error) {
  console.error(`Failed to run gofmt: ${result.error.message}`)
  process.exit(1)
}

if (typeof result.status === 'number' && result.status !== 0) {
  if (result.stderr) {
    console.error(result.stderr.trim())
  }
  process.exit(result.status)
}

if (write) {
  console.log(`Formatted ${goFiles.length} Go files with gofmt.`)
  process.exit(0)
}

const unformattedFiles = result.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)

if (unformattedFiles.length > 0) {
  console.error('Go files need formatting:')
  for (const file of unformattedFiles) {
    console.error(file)
  }
  process.exit(1)
}

console.log(`Checked ${goFiles.length} Go files with gofmt.`)
