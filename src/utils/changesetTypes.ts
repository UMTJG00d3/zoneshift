// Changeset types for Bulk Changes feature

export interface ChangesetChange {
  action: 'create' | 'update' | 'delete';
  recordId?: number;
  type: string;
  name: string;
  value: string;
  ttl: number;
}

export interface Changeset {
  domain: string;
  domainId: number;
  description: string;
  createdAt: string;
  createdBy: string;
  totalChanges: number;
  changes: ChangesetChange[];
}

export interface ChangesetValidationError {
  index: number;
  field: string;
  message: string;
}

export interface ExecutionResult {
  change: ChangesetChange;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

export interface ExecutionProgress {
  current: number;
  total: number;
  currentRecord: string;
  action: string;
  results: ExecutionResult[];
  isPaused: boolean;
  isCancelled: boolean;
}

export interface ExecutionSummary {
  success: number;
  failed: number;
  skipped: number;
  results: ExecutionResult[];
}

export function parseChangeset(jsonContent: string): { changeset: Changeset | null; errors: ChangesetValidationError[] } {
  const errors: ChangesetValidationError[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (e) {
    errors.push({ index: -1, field: 'json', message: `Invalid JSON: ${(e as Error).message}` });
    return { changeset: null, errors };
  }

  const data = parsed as Record<string, unknown>;

  // Validate required fields
  if (!data.domain || typeof data.domain !== 'string') {
    errors.push({ index: -1, field: 'domain', message: 'Missing or invalid "domain" field' });
  }
  if (!data.domainId || typeof data.domainId !== 'number') {
    errors.push({ index: -1, field: 'domainId', message: 'Missing or invalid "domainId" field' });
  }
  if (!Array.isArray(data.changes)) {
    errors.push({ index: -1, field: 'changes', message: 'Missing or invalid "changes" array' });
    return { changeset: null, errors };
  }

  // Validate each change
  const changes = data.changes as Array<Record<string, unknown>>;
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    if (!['create', 'update', 'delete'].includes(change.action as string)) {
      errors.push({ index: i, field: 'action', message: `Invalid action: ${change.action}` });
    }

    if (change.action === 'delete' && !change.recordId) {
      errors.push({ index: i, field: 'recordId', message: 'Delete action requires recordId' });
    }

    if (change.action === 'create') {
      if (!change.type) {
        errors.push({ index: i, field: 'type', message: 'Create action requires type' });
      }
      if (change.name === undefined || change.name === null) {
        errors.push({ index: i, field: 'name', message: 'Create action requires name' });
      }
      if (!change.value) {
        errors.push({ index: i, field: 'value', message: 'Create action requires value' });
      }
    }

    if (change.action === 'update' && !change.recordId) {
      errors.push({ index: i, field: 'recordId', message: 'Update action requires recordId' });
    }
  }

  if (errors.length > 0) {
    return { changeset: null, errors };
  }

  const changeset: Changeset = {
    domain: data.domain as string,
    domainId: data.domainId as number,
    description: (data.description as string) || '',
    createdAt: (data.createdAt as string) || new Date().toISOString(),
    createdBy: (data.createdBy as string) || 'Unknown',
    totalChanges: changes.length,
    changes: changes.map(c => ({
      action: c.action as 'create' | 'update' | 'delete',
      recordId: c.recordId as number | undefined,
      type: (c.type as string) || '',
      name: (c.name as string) ?? '',
      value: (c.value as string) || '',
      ttl: (c.ttl as number) || 3600,
    })),
  };

  return { changeset, errors: [] };
}

export function getChangeStats(changes: ChangesetChange[]): { create: number; update: number; delete: number } {
  return changes.reduce(
    (acc, c) => {
      acc[c.action]++;
      return acc;
    },
    { create: 0, update: 0, delete: 0 }
  );
}
