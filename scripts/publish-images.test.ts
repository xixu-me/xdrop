import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

const repoRoot = join(import.meta.dir, '..')

describe('publish image configuration', () => {
  it('publishes a multi-platform image for amd64 and arm64', () => {
    const workflow = readFileSync(
      join(repoRoot, '.github', 'workflows', 'publish-images.yml'),
      'utf8',
    )

    expect(workflow).toContain('platforms: linux/amd64,linux/arm64')
  })

  it('builds the API binary for the target image architecture', () => {
    const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8')

    expect(dockerfile).toContain('ARG TARGETOS')
    expect(dockerfile).toContain('ARG TARGETARCH')
    expect(dockerfile).toContain('GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build')
  })
})
