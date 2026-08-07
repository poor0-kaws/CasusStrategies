import type { SourceDocument } from "./schemas";

export interface ContentHashedRecord {
  contentHash: string;
}

export function wasSourceKnownBy(source: SourceDocument, forecastCutoffAt: string): boolean {
  const observedAt = Date.parse(source.observedAt);
  const cutoffAt = Date.parse(forecastCutoffAt);

  if (!Number.isFinite(observedAt) || !Number.isFinite(cutoffAt)) {
    return false;
  }

  return observedAt <= cutoffAt;
}

export function deduplicateByContentHash<T extends ContentHashedRecord>(records: T[]): T[] {
  const uniqueRecords: T[] = [];
  const seenHashes = new Set<string>();

  for (const record of records) {
    if (seenHashes.has(record.contentHash)) {
      continue;
    }

    seenHashes.add(record.contentHash);
    uniqueRecords.push(record);
  }

  return uniqueRecords;
}
