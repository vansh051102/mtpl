// Offline draft queue for the Contact call-log/reminder forms (Gap 19).
//
// ponytail: this is IndexedDB + online/offline events, not a registered
// Service Worker — there's no requirement for the app to load while offline,
// only for a call-log/reminder submit to survive a network blip instead of
// silently failing. A full SW (registration, cache strategy, update
// lifecycle) would be real infra for a need this doesn't have. Upgrade to a
// SW if offline page-load ever becomes an actual requirement.

const DB_NAME = 'veck-offline-queue'
const STORE = 'mutations'

export interface QueuedMutation {
  id: string // clientMutationId — also the IndexedDB key
  path: string // e.g. `/contacts/${id}/activities`
  body: Record<string, unknown>
  createdAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function queueMutation(mutation: QueuedMutation): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(mutation)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function listQueuedMutations(): Promise<QueuedMutation[]> {
  const db = await openDb()
  const result = await new Promise<QueuedMutation[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as QueuedMutation[])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return result.sort((a, b) => a.createdAt - b.createdAt)
}

export async function removeQueuedMutation(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
