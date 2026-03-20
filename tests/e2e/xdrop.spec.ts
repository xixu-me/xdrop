import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080'
const API_BASE_URL = process.env.E2E_API_URL ?? `${BASE_URL}/api/v1`
const INVALID_LINK_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  resetRateLimitState()
  await resetLocalBrowserState(page)
})

test('encrypts a single file end to end and rejects missing or invalid keys', async ({
  context,
  page,
  request,
}, testInfo) => {
  const suffix = uniqueSuffix()
  const transferName = `Single Capsule ${suffix}`
  const fileName = `single-e2e-note-${suffix}.txt`
  const contentMarker = `XDROP_E2E_SINGLE_${suffix}_ALPHA`

  const { shareLink, transferId } = await createSingleFileTransfer(page, {
    transferName,
    fileName,
    content: contentMarker,
  })

  const senderRecord = await readLocalTransfer(page, transferId)
  expect(senderRecord?.files?.length).toBe(1)

  const receiver = await context.newPage()
  const seenRequests: string[] = []
  receiver.on('request', (request) => {
    seenRequests.push(request.url())
  })
  await receiver.goto(shareLink, { waitUntil: 'networkidle' })

  await expect(receiver.getByText(fileName).first()).toBeVisible()
  const [download] = await Promise.all([
    receiver.waitForEvent('download'),
    receiver.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  const downloadedFilePath = testInfo.outputPath(fileName)
  await download.saveAs(downloadedFilePath)
  expect(await readFile(downloadedFilePath, 'utf8')).toBe(contentMarker)
  expect(seenRequests.some((url) => url.includes('#k='))).toBeFalsy()

  await assertCiphertextOnlyStorage(request, page, transferId, senderRecord.files[0].fileId, [
    transferName,
    fileName,
    contentMarker,
  ])

  const missingKeyPage = await context.newPage()
  await missingKeyPage.goto(stripFragment(shareLink), { waitUntil: 'networkidle' })
  await expect(
    missingKeyPage.getByRole('heading', { name: "Can't open this transfer" }),
  ).toBeVisible()
  await expect(missingKeyPage.getByText('This link is missing the decryption key.')).toBeVisible()

  const invalidKeyPage = await context.newPage()
  await invalidKeyPage.goto(withLinkKey(shareLink, INVALID_LINK_KEY), { waitUntil: 'networkidle' })
  await expect(
    invalidKeyPage.getByRole('heading', { name: "Can't open this transfer" }),
  ).toBeVisible()
  await expect(invalidKeyPage.getByText('This decryption key is invalid.')).toBeVisible()
})

test('preserves folder paths, downloads a zip, and manages transfers', async ({
  context,
  page,
  request,
}, testInfo) => {
  const suffix = uniqueSuffix()
  const transferName = `Folder Capsule ${suffix}`
  const folderName = `folder-capsule-${suffix}`
  const readmePath = `${folderName}/docs/readme-e2e.txt`
  const notesPath = `${folderName}/nested/notes-e2e.txt`
  const readmeMarker = `XDROP_E2E_FOLDER_README_${suffix}_BETA`
  const notesMarker = `XDROP_E2E_FOLDER_NOTES_${suffix}_GAMMA`

  const { shareLink, transferId } = await createFolderTransfer(page, {
    transferName,
    files: [
      { name: 'readme-e2e.txt', relativePath: readmePath, content: readmeMarker },
      { name: 'notes-e2e.txt', relativePath: notesPath, content: notesMarker },
    ],
  })

  const receiver = await context.newPage()
  await receiver.goto(shareLink, { waitUntil: 'networkidle' })
  await expect(receiver.getByText(readmePath, { exact: true })).toBeVisible()
  await expect(receiver.getByText(notesPath, { exact: true })).toBeVisible()

  const [download] = await Promise.all([
    receiver.waitForEvent('download'),
    receiver.getByRole('button', { name: /Download all as(?: a)? ZIP/i }).click(),
  ])
  const zipPath = testInfo.outputPath(`folder-${suffix}.zip`)
  await download.saveAs(zipPath)
  const zipEntries = await readZipEntries(zipPath)
  expect(zipEntries[readmePath]).toBe(readmeMarker)
  expect(zipEntries[notesPath]).toBe(notesMarker)

  await page.goto(`${BASE_URL}/transfers`, { waitUntil: 'networkidle' })
  const card = page.locator('section').filter({ hasText: transferName }).first()
  await expect(card).toContainText(transferName)

  const descriptorBefore = await getPublicDescriptor(request, transferId)
  const expiryBefore = Date.parse(descriptorBefore.expiresAt)
  await card.getByRole('button', { name: 'Set expiry to 1 week from now' }).click()
  await expect
    .poll(async () => Date.parse((await getPublicDescriptor(request, transferId)).expiresAt))
    .toBeGreaterThan(expiryBefore)

  await receiver.reload({ waitUntil: 'networkidle' })
  await expect(receiver.getByText(transferName).first()).toBeVisible()

  await card.getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('section').filter({ hasText: transferName })).toHaveCount(0)
  await receiver.reload({ waitUntil: 'networkidle' })
  await expect(receiver.getByRole('heading', { name: 'Transfer deleted' })).toBeVisible()
  await expect(receiver.getByText('The sender removed it from storage.')).toBeVisible()
})

test('continues an in-flight upload after refresh without manual recovery', async ({
  context,
  page,
  request,
}, testInfo) => {
  const suffix = uniqueSuffix()
  const transferName = `Resume Capsule ${suffix}`
  const fileName = `refresh-recovery-${suffix}.bin`

  await page.route('**/xdrop/transfers/**/chunks/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    try {
      await route.continue()
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Route is already handled')) {
        throw error
      }
    }
  })

  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.getByLabel('Transfer name').fill(transferName)
  const uploadPath = testInfo.outputPath(fileName)
  await writeFile(uploadPath, Buffer.alloc(64 * 1024 * 1024, 0x61))
  await page.locator('input[type=file]').first().setInputFiles(uploadPath)
  await page.getByRole('button', { name: 'Start transfer' }).click()
  await expect(page).toHaveURL(/\/share\//, { timeout: 60_000 })
  const shareLink = await readShareLink(page)
  const transferId = transferIdFromSharePage(page.url())

  await page.getByRole('link', { name: 'Transfers', exact: true }).click()
  const card = page.locator('section').filter({ hasText: transferName }).first()
  await expect(card).toContainText(transferName)

  const resumeRequest = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes(`/transfers/${transferId}/resume`),
  )
  await page.reload({ waitUntil: 'networkidle' })
  await resumeRequest
  await expect(card.getByRole('button', { name: 'Resume upload' })).toHaveCount(0)

  await page.unroute('**/xdrop/transfers/**/chunks/**')

  await expect
    .poll(async () => (await getPublicDescriptor(request, transferId)).status, { timeout: 180_000 })
    .toBe('ready')

  await page.reload({ waitUntil: 'networkidle' })
  await expect(card).toContainText('Ready')

  const receiver = await context.newPage()
  await receiver.goto(shareLink, { waitUntil: 'networkidle' })
  await expect(receiver.getByText(fileName).first()).toBeVisible()
})

async function createSingleFileTransfer(
  page: Page,
  options: {
    transferName: string
    fileName: string
    content: string
  },
) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.getByLabel('Transfer name').fill(options.transferName)
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: options.fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(options.content, 'utf8'),
    })
  await page.getByRole('button', { name: 'Start transfer' }).click()
  await expect(page).toHaveURL(/\/share\//, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Share the full link.' })).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.locator('.status-badge').filter({ hasText: 'Ready' })).toBeVisible({
    timeout: 60_000,
  })
  return {
    transferId: transferIdFromSharePage(page.url()),
    shareLink: await readShareLink(page),
  }
}

async function createFolderTransfer(
  page: Page,
  options: {
    transferName: string
    files: Array<{
      name: string
      relativePath: string
      content: string
    }>
  },
) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.getByLabel('Transfer name').fill(options.transferName)
  await page.evaluate((files) => {
    const input = document.querySelectorAll('input[type=file]')[1]
    const dataTransfer = new DataTransfer()
    for (const file of files) {
      const nextFile = new File([file.content], file.name, {
        type: 'text/plain',
        lastModified: Date.now(),
      })
      Object.defineProperty(nextFile, 'webkitRelativePath', { value: file.relativePath })
      dataTransfer.items.add(nextFile)
    }
    input.files = dataTransfer.files
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, options.files)
  await page.getByRole('button', { name: 'Start transfer' }).click()
  await expect(page).toHaveURL(/\/share\//, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Share the full link.' })).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.locator('.status-badge').filter({ hasText: 'Ready' })).toBeVisible({
    timeout: 60_000,
  })
  return {
    transferId: transferIdFromSharePage(page.url()),
    shareLink: await readShareLink(page),
  }
}

async function readShareLink(page: Page) {
  const transferId = transferIdFromSharePage(page.url())
  const transfer = await readLocalTransfer(page, transferId)
  if (!transfer?.shareUrl) {
    throw new Error(`Could not read share link for ${transferId}`)
  }
  return transfer.shareUrl
}

function transferIdFromSharePage(url: string) {
  const pathname = new URL(url).pathname
  const transferId = pathname.split('/').pop()
  if (!transferId) {
    throw new Error(`Could not parse transfer id from ${url}`)
  }
  return transferId
}

async function resetLocalBrowserState(page: Page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map((name) => caches.delete(name)))
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('xdrop-local')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => resolve()
    })
  })
}

async function readLocalTransfer(page: Page, transferId: string) {
  return page.evaluate(async (id) => {
    return new Promise<any>((resolve, reject) => {
      const request = indexedDB.open('xdrop-local')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('transfers', 'readonly')
        const store = transaction.objectStore('transfers')
        const getRequest = store.get(id)
        getRequest.onerror = () => reject(getRequest.error)
        getRequest.onsuccess = () => resolve(getRequest.result ?? null)
      }
    })
  }, transferId)
}

async function assertCiphertextOnlyStorage(
  request: APIRequestContext,
  page: Page,
  transferId: string,
  fileId: string,
  patterns: string[],
) {
  const descriptor = await getPublicDescriptor(request, transferId)
  const descriptorText = JSON.stringify(descriptor)
  for (const pattern of patterns) {
    expect(descriptorText).not.toContain(pattern)
  }

  const manifestResponse = await request.get(descriptor.manifestUrl!)
  expect(manifestResponse.ok()).toBeTruthy()
  const manifestBytes = Buffer.from(await manifestResponse.body())
  for (const pattern of patterns) {
    expect(manifestBytes.includes(Buffer.from(pattern, 'utf8'))).toBeFalsy()
  }

  const downloadUrlsResponse = await request.post(
    `${API_BASE_URL}/public/transfers/${transferId}/download-urls`,
    {
      data: {
        chunks: [{ fileId, chunkIndex: 0 }],
      },
    },
  )
  expect(downloadUrlsResponse.ok()).toBeTruthy()
  const downloadUrlsPayload = (await downloadUrlsResponse.json()) as {
    items: Array<{ url: string }>
  }
  expect(downloadUrlsPayload.items).toHaveLength(1)
  const chunkUrl = downloadUrlsPayload.items[0].url
  for (const pattern of patterns) {
    expect(chunkUrl).not.toContain(pattern)
  }
  const chunkResponse = await request.get(chunkUrl)
  expect(chunkResponse.ok()).toBeTruthy()
  const chunkBytes = Buffer.from(await chunkResponse.body())
  for (const pattern of patterns) {
    expect(chunkBytes.includes(Buffer.from(pattern, 'utf8'))).toBeFalsy()
  }

  const dump = execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'pg_dump',
      '-U',
      'xdrop',
      '-d',
      'xdrop',
      '--data-only',
      '--inserts',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  )
  for (const pattern of patterns) {
    expect(dump).not.toContain(pattern)
  }

  const localTransfer = await readLocalTransfer(page, transferId)
  expect(localTransfer?.shareUrl).toContain(`#k=`)
}

async function getPublicDescriptor(request: APIRequestContext, transferId: string) {
  const response = await request.get(`${API_BASE_URL}/public/transfers/${transferId}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as {
    status: string
    expiresAt: string
    manifestUrl?: string
  }
}

async function readZipEntries(zipPath: string) {
  const zipBytes = await readFile(zipPath)
  const reader = new ZipReader(new BlobReader(new Blob([zipBytes])))
  const entries = await reader.getEntries()
  const contents: Record<string, string> = {}

  for (const entry of entries) {
    if (entry.directory) {
      continue
    }
    contents[entry.filename] = await entry.getData!(new TextWriter())
  }

  await reader.close()
  return contents
}

function stripFragment(url: string) {
  return url.replace(/#.*$/, '')
}

function withLinkKey(url: string, linkKey: string) {
  return `${stripFragment(url)}#k=${linkKey}`
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function resetRateLimitState() {
  execFileSync('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', 'FLUSHALL'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
}
