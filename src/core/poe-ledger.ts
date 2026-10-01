export interface PoeEntry {
  queryId: string;
  time: number;
  points: number;
  usageType: string;
  bot: string;
}

export interface PoeLedger {
  has(queryId: string): Promise<boolean>;
  putMany(entries: PoeEntry[]): Promise<void>;
  range(startMs: number, endMs: number): Promise<PoeEntry[]>;
  getMeta(): Promise<{ coverageStart?: number }>;
  setMeta(meta: { coverageStart?: number }): Promise<void>;
  prune(olderThanMs: number): Promise<void>;
}

export class MemoryPoeLedger implements PoeLedger {
  private readonly entries = new Map<string, PoeEntry>();
  private meta: { coverageStart?: number } = {};

  async has(queryId: string): Promise<boolean> {
    return this.entries.has(queryId);
  }

  async putMany(entries: PoeEntry[]): Promise<void> {
    for (const entry of entries) this.entries.set(entry.queryId, { ...entry });
  }

  async range(startMs: number, endMs: number): Promise<PoeEntry[]> {
    return Array.from(this.entries.values())
      .filter((entry) => entry.time >= startMs && entry.time < endMs)
      .sort((left, right) => left.time - right.time)
      .map((entry) => ({ ...entry }));
  }

  async getMeta(): Promise<{ coverageStart?: number }> {
    return { ...this.meta };
  }

  async setMeta(meta: { coverageStart?: number }): Promise<void> {
    this.meta = { ...meta };
  }

  async prune(olderThanMs: number): Promise<void> {
    for (const [queryId, entry] of this.entries) {
      if (entry.time < olderThanMs) this.entries.delete(queryId);
    }
  }
}

interface MetaRecord {
  key: 'meta';
  coverageStart?: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IdbPoeLedger implements PoeLedger {
  private dbPromise: Promise<IDBDatabase> | undefined;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('llm-usage-glance', 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          const poe = database.createObjectStore('poe', { keyPath: 'queryId' });
          poe.createIndex('time', 'time');
          database.createObjectStore('meta', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
      });
    }
    return this.dbPromise;
  }

  async has(queryId: string): Promise<boolean> {
    const database = await this.open();
    const transaction = database.transaction('poe', 'readonly');
    const value = await requestResult(transaction.objectStore('poe').getKey(queryId));
    await transactionComplete(transaction);
    return value !== undefined;
  }

  async putMany(entries: PoeEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const database = await this.open();
    const transaction = database.transaction('poe', 'readwrite');
    const store = transaction.objectStore('poe');
    for (const entry of entries) store.put(entry);
    await transactionComplete(transaction);
  }

  async range(startMs: number, endMs: number): Promise<PoeEntry[]> {
    const database = await this.open();
    const transaction = database.transaction('poe', 'readonly');
    const index = transaction.objectStore('poe').index('time');
    const values = await requestResult(index.getAll(IDBKeyRange.bound(startMs, endMs, false, true)));
    await transactionComplete(transaction);
    return values as PoeEntry[];
  }

  async getMeta(): Promise<{ coverageStart?: number }> {
    const database = await this.open();
    const transaction = database.transaction('meta', 'readonly');
    const value = await requestResult(transaction.objectStore('meta').get('meta')) as MetaRecord | undefined;
    await transactionComplete(transaction);
    return value?.coverageStart === undefined ? {} : { coverageStart: value.coverageStart };
  }

  async setMeta(meta: { coverageStart?: number }): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction('meta', 'readwrite');
    const record: MetaRecord = { key: 'meta', ...meta };
    transaction.objectStore('meta').put(record);
    await transactionComplete(transaction);
  }

  async prune(olderThanMs: number): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction('poe', 'readwrite');
    const index = transaction.objectStore('poe').index('time');
    const request = index.openCursor(IDBKeyRange.upperBound(olderThanMs, true));
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
    });
    await transactionComplete(transaction);
  }
}
