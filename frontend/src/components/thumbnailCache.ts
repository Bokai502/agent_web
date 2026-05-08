const DB_NAME = "codex-thumbnail-cache"
const DB_VERSION = 1
const STORE_NAME = "thumbnails"
const MAX_CACHE_ENTRIES = 80
const WEBP_QUALITY = 0.9
const PNG_QUALITY = 0.96
export const THUMBNAIL_CACHE_UPDATED_EVENT = "codex:thumbnail-cache-updated"

export const LEGACY_THUMBNAIL_CACHE_PREFIX = "codex:model-preview-image:v3:"
export const LEGACY_SAMPLE_THUMBNAIL_CACHE_PREFIX = "codex:model-preview-image:v5:sample:"
export const CURRENT_THUMBNAIL_CACHE_PREFIX = "codex:model-preview-image:v5:"
export const SAMPLE_THUMBNAIL_CACHE_PREFIX = "codex:model-preview-image:v8:sample:"

type ThumbnailRecord = {
  blob: Blob
  createdAt: number
  key: string
  lastAccessedAt: number
  mimeType: string
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null)
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" })
        store.createIndex("lastAccessedAt", "lastAccessedAt")
      }
    }
    request.onerror = () => resolve(null)
    request.onsuccess = () => resolve(request.result)
  })

  return dbPromise
}

function getStore(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T | null>((resolve) => {
    request.onerror = () => resolve(null)
    request.onsuccess = () => resolve(request.result)
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
    transaction.onabort = () => resolve()
  })
}

async function pruneThumbnailCache(db: IDBDatabase) {
  const transaction = db.transaction(STORE_NAME, "readwrite")
  const store = transaction.objectStore(STORE_NAME)
  const records: ThumbnailRecord[] = []
  const request = store.openCursor()

  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    records.push(cursor.value as ThumbnailRecord)
    cursor.continue()
  }

  await transactionDone(transaction)
  if (records.length <= MAX_CACHE_ENTRIES) return

  const deleteTransaction = db.transaction(STORE_NAME, "readwrite")
  const deleteStore = deleteTransaction.objectStore(STORE_NAME)
  records
    .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)
    .slice(0, records.length - MAX_CACHE_ENTRIES)
    .forEach(record => deleteStore.delete(record.key))
  await transactionDone(deleteTransaction)
}

export async function readCachedThumbnailBlob(cacheKey: string) {
  const db = await openDb()
  if (!db) return null

  const record = await requestToPromise<ThumbnailRecord>(
    getStore(db, "readonly").get(cacheKey),
  )
  if (!record?.blob) return null

  const now = Date.now()
  const transaction = db.transaction(STORE_NAME, "readwrite")
  transaction.objectStore(STORE_NAME).put({ ...record, lastAccessedAt: now })
  await transactionDone(transaction)
  return record.blob
}

export async function readLatestCachedThumbnailBlob(prefix: string) {
  const db = await openDb()
  if (!db) return null

  const transaction = db.transaction(STORE_NAME, "readonly")
  const store = transaction.objectStore(STORE_NAME)
  const records: ThumbnailRecord[] = []
  const request = store.openCursor()

  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    const record = cursor.value as ThumbnailRecord
    if (record.key.startsWith(prefix)) records.push(record)
    cursor.continue()
  }

  await transactionDone(transaction)
  const latest = records.sort((left, right) => left.createdAt - right.createdAt).at(-1)
  if (!latest?.blob) return null

  const writeTransaction = db.transaction(STORE_NAME, "readwrite")
  writeTransaction.objectStore(STORE_NAME).put({ ...latest, lastAccessedAt: Date.now() })
  await transactionDone(writeTransaction)
  return latest.blob
}

export async function writeCachedThumbnailBlob(cacheKey: string, blob: Blob) {
  const db = await openDb()
  if (!db) return false

  const now = Date.now()
  const record: ThumbnailRecord = {
    blob,
    createdAt: now,
    key: cacheKey,
    lastAccessedAt: now,
    mimeType: blob.type || "image/webp",
  }
  const transaction = db.transaction(STORE_NAME, "readwrite")
  transaction.objectStore(STORE_NAME).put(record)
  await transactionDone(transaction)
  window.dispatchEvent(new CustomEvent(THUMBNAIL_CACHE_UPDATED_EVENT, { detail: { key: cacheKey } }))
  void pruneThumbnailCache(db)
  return true
}

function findLatestLegacyCacheValue(prefix: string) {
  try {
    const keys: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix)) keys.push(key)
    }

    const cacheKey = keys.sort().at(-1)
    return cacheKey ? localStorage.getItem(cacheKey) : null
  } catch {
    return null
  }
}

export function readLatestLegacyThumbnail(prefixes: string[]) {
  for (const prefix of prefixes) {
    const value = findLatestLegacyCacheValue(prefix)
    if (value) return value
  }
  return null
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = WEBP_QUALITY) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((webpBlob) => {
      if (webpBlob) {
        resolve(webpBlob)
        return
      }

      canvas.toBlob((pngBlob) => resolve(pngBlob), "image/png", PNG_QUALITY)
    }, "image/webp", quality)
  })
}

export async function cacheCanvasThumbnail(cacheKey: string, canvas: HTMLCanvasElement, quality = WEBP_QUALITY) {
  const blob = await canvasToBlob(canvas, quality)
  if (!blob) return null

  const stored = await writeCachedThumbnailBlob(cacheKey, blob)
  return stored ? blob : null
}

export function createObjectUrl(blob: Blob) {
  return URL.createObjectURL(blob)
}
