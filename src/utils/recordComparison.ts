import { ResolvedRecord } from './dnsLookup';

export type MatchStatus = 'match' | 'mismatch' | 'missing_new' | 'missing_old' | 'new';

export interface ComparisonRow {
  name: string;
  type: string;
  ttlOld?: number;
  ttlNew?: number;
  valueOld?: string;
  valueNew?: string;
  status: MatchStatus;
}

export interface ComparisonResult {
  rows: ComparisonRow[];
  totalRecords: number;
  matchCount: number;
  mismatchCount: number;
  missingNewCount: number;
  newCount: number;
}

function normalizeValue(value: string): string {
  return value
    .replace(/\.$/, '')
    .replace(/^"|"$/g, '')
    .toLowerCase()
    .trim();
}

function recordKey(r: ResolvedRecord): string {
  return `${r.name.toLowerCase()}|${r.type}`;
}

export function compareRecords(
  oldRecords: ResolvedRecord[],
  newRecords: ResolvedRecord[],
): ComparisonResult {
  const rows: ComparisonRow[] = [];

  // Group records by name+type, allowing multiple values per key
  const oldByKey = new Map<string, ResolvedRecord[]>();
  const newByKey = new Map<string, ResolvedRecord[]>();

  for (const r of oldRecords) {
    const key = recordKey(r);
    if (!oldByKey.has(key)) oldByKey.set(key, []);
    oldByKey.get(key)!.push(r);
  }

  for (const r of newRecords) {
    const key = recordKey(r);
    if (!newByKey.has(key)) newByKey.set(key, []);
    newByKey.get(key)!.push(r);
  }

  const allKeys = new Set([...oldByKey.keys(), ...newByKey.keys()]);

  for (const key of allKeys) {
    const oldRecs = oldByKey.get(key) || [];
    const newRecs = newByKey.get(key) || [];

    const [name, type] = key.split('|');

    if (oldRecs.length === 0) {
      // Records only in new NS
      for (const nr of newRecs) {
        rows.push({
          name,
          type,
          ttlNew: nr.ttl,
          valueNew: nr.value,
          status: 'new',
        });
      }
      continue;
    }

    if (newRecs.length === 0) {
      // Records only in old NS
      for (const or of oldRecs) {
        rows.push({
          name,
          type,
          ttlOld: or.ttl,
          valueOld: or.value,
          status: 'missing_new',
        });
      }
      continue;
    }

    // Match old and new values
    const oldValues = new Set(oldRecs.map((r) => normalizeValue(r.value)));

    // Check each old record for a match in new
    for (const or of oldRecs) {
      const normOld = normalizeValue(or.value);
      const matchingNew = newRecs.find(
        (nr) => normalizeValue(nr.value) === normOld,
      );

      if (matchingNew) {
        rows.push({
          name,
          type,
          ttlOld: or.ttl,
          ttlNew: matchingNew.ttl,
          valueOld: or.value,
          valueNew: matchingNew.value,
          status: 'match',
        });
      } else {
        rows.push({
          name,
          type,
          ttlOld: or.ttl,
          valueOld: or.value,
          status: 'mismatch',
        });
      }
    }

    // Check for new values not in old
    for (const nr of newRecs) {
      const normNew = normalizeValue(nr.value);
      if (!oldValues.has(normNew)) {
        rows.push({
          name,
          type,
          ttlNew: nr.ttl,
          valueNew: nr.value,
          status: 'mismatch',
        });
      }
    }
  }

  // Sort rows: by name, then type
  rows.sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.type.localeCompare(b.type);
  });

  const matchCount = rows.filter((r) => r.status === 'match').length;
  const mismatchCount = rows.filter((r) => r.status === 'mismatch').length;
  const missingNewCount = rows.filter((r) => r.status === 'missing_new').length;
  const newCount = rows.filter((r) => r.status === 'new').length;

  return {
    rows,
    totalRecords: rows.length,
    matchCount,
    mismatchCount,
    missingNewCount,
    newCount,
  };
}
