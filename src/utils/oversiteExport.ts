// Over-Site export utility for ZoneShift data

import { downloadJson } from './changesetExecutor';

export interface OversiteExportData {
  exportedAt: string;
  version: string;
  scanResults: unknown[];
  changesetHistory: unknown[];
  approvedLists: Record<string, unknown>;
}

export function exportForOversite(): void {
  const data: OversiteExportData = {
    exportedAt: new Date().toISOString(),
    version: '1.0',

    // Scan results from Security Scanner
    scanResults: JSON.parse(localStorage.getItem('zoneshift_scan_results') || '[]'),

    // Changeset history from Bulk Changes
    changesetHistory: JSON.parse(localStorage.getItem('zoneshift_history') || '[]'),

    // Approved lists per domain
    approvedLists: JSON.parse(localStorage.getItem('zoneshift_approved_lists') || '{}'),
  };

  downloadJson(data, `zoneshift-export-${Date.now()}.json`);
}

export function getExportStats(): { scanCount: number; changesetCount: number; approvedDomains: number } {
  const scanResults = JSON.parse(localStorage.getItem('zoneshift_scan_results') || '[]');
  const history = JSON.parse(localStorage.getItem('zoneshift_history') || '[]');
  const approvedLists = JSON.parse(localStorage.getItem('zoneshift_approved_lists') || '{}');

  return {
    scanCount: scanResults.length,
    changesetCount: history.length,
    approvedDomains: Object.keys(approvedLists).length,
  };
}
