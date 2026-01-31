// Changeset executor for Bulk Changes feature

import {
  ConstellixCredentials,
  addRecord,
  updateRecord,
  deleteRecord,
  listRecords,
} from './constellixApi';
import {
  Changeset,
  ExecutionResult,
  ExecutionProgress,
  ExecutionSummary,
} from './changesetTypes';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface ExecutorControl {
  isPaused: boolean;
  isCancelled: boolean;
}

export async function executeChangeset(
  creds: ConstellixCredentials,
  changeset: Changeset,
  selectedIndices: Set<number>,
  control: ExecutorControl,
  onProgress: (progress: ExecutionProgress) => void
): Promise<ExecutionSummary> {
  const results: ExecutionResult[] = [];
  const selectedChanges = changeset.changes.filter((_, i) => selectedIndices.has(i));
  const total = selectedChanges.length;

  for (let i = 0; i < selectedChanges.length; i++) {
    // Check for cancel
    if (control.isCancelled) {
      // Mark remaining as skipped
      for (let j = i; j < selectedChanges.length; j++) {
        results.push({
          change: selectedChanges[j],
          status: 'skipped',
          error: 'Cancelled by user',
        });
      }
      break;
    }

    // Wait while paused
    while (control.isPaused && !control.isCancelled) {
      onProgress({
        current: i,
        total,
        currentRecord: selectedChanges[i].name || '@',
        action: selectedChanges[i].action,
        results: [...results],
        isPaused: true,
        isCancelled: false,
      });
      await sleep(100);
    }

    if (control.isCancelled) continue;

    const change = selectedChanges[i];

    onProgress({
      current: i + 1,
      total,
      currentRecord: change.name || '@',
      action: change.action,
      results: [...results],
      isPaused: false,
      isCancelled: false,
    });

    try {
      let result: { success: boolean; error?: string };

      switch (change.action) {
        case 'delete':
          result = await deleteRecord(
            creds,
            changeset.domainId,
            change.recordId!,
            change.type
          );
          break;

        case 'create':
          result = await addRecord(
            creds,
            changeset.domainId,
            change.name,
            change.type,
            change.ttl,
            change.value
          );
          break;

        case 'update':
          result = await updateRecord(
            creds,
            changeset.domainId,
            change.recordId!,
            change.type,
            change.name,
            change.ttl,
            change.value
          );
          break;

        default:
          result = { success: false, error: `Unknown action: ${change.action}` };
      }

      results.push({
        change,
        status: result.success ? 'success' : 'failed',
        error: result.error,
      });
    } catch (error) {
      results.push({
        change,
        status: 'failed',
        error: (error as Error).message,
      });
    }

    // Rate limiting - 200ms between calls (faster than regular push since these are targeted operations)
    if (i < selectedChanges.length - 1) {
      await sleep(200);
    }
  }

  const summary: ExecutionSummary = {
    success: results.filter(r => r.status === 'success').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
  };

  return summary;
}

export interface BackupData {
  exportedAt: string;
  domain: string;
  domainId: number;
  records: Array<{
    id: number;
    name: string;
    type: string;
    ttl: number;
    value: string;
  }>;
}

export async function exportBackup(
  creds: ConstellixCredentials,
  domain: string,
  domainId: number
): Promise<{ backup: BackupData | null; error?: string }> {
  const { records, error } = await listRecords(creds, domainId);

  if (error) {
    return { backup: null, error };
  }

  const backup: BackupData = {
    exportedAt: new Date().toISOString(),
    domain,
    domainId,
    records: records.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      ttl: r.ttl,
      value: r.value,
    })),
  };

  return { backup };
}

export function downloadJson(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Save execution to history (localStorage)
export function saveToHistory(
  changeset: Changeset,
  summary: ExecutionSummary
): void {
  const historyKey = 'zoneshift_history';
  const existing = localStorage.getItem(historyKey);
  const history = existing ? JSON.parse(existing) : [];

  history.unshift({
    id: crypto.randomUUID(),
    executedAt: new Date().toISOString(),
    domain: changeset.domain,
    domainId: changeset.domainId,
    description: changeset.description,
    totalChanges: changeset.totalChanges,
    results: {
      success: summary.success,
      failed: summary.failed,
      skipped: summary.skipped,
    },
  });

  // Keep last 50 entries
  localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 50)));
}
