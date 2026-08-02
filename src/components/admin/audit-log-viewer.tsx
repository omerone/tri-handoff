'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Download, Filter, RefreshCw } from 'lucide-react';

/**
 * Audit Log Viewer Component
 *
 * Admin dashboard component for viewing and filtering database audit logs
 * Features:
 * - Table view of recent audit logs
 * - Filters: by user, table, operation, date range
 * - Search and highlight suspicious operations
 * - Export to CSV
 * - Real-time refresh capability
 *
 * Usage:
 *   <AuditLogViewer />
 */

interface AuditLog {
  id: string;
  tableName: string;
  operation: string;
  recordId: string;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  executionTimeMs: number | null;
  suspicious: boolean;
  suspicionReason: string | null;
  createdAt: Date;
}

interface Filters {
  user?: string;
  table?: string;
  operation?: string;
  suspicious?: boolean;
  startDate?: Date;
  endDate?: Date;
}

export function AuditLogViewer() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Load audit logs
  useEffect(() => {
    loadLogs();
  }, [filters]);

  async function loadLogs() {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filters.user) params.append('user', filters.user);
      if (filters.table) params.append('table', filters.table);
      if (filters.operation) params.append('operation', filters.operation);
      if (filters.suspicious) params.append('suspicious', 'true');
      params.append('limit', '100');

      const response = await fetch(`/api/admin/audit-logs?${params}`);

      if (!response.ok) {
        throw new Error('Failed to load audit logs');
      }

      const data = await response.json();
      setLogs(data.data || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function exportToCSV() {
    try {
      const params = new URLSearchParams({
        format: 'csv',
      });

      if (filters.user) params.append('user', filters.user);
      if (filters.table) params.append('table', filters.table);

      const response = await fetch(`/api/admin/audit-logs?${params}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError('Failed to export logs');
    }
  }

  const handleFilterChange = (key: keyof Filters, value: any) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value || undefined,
    }));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Database Audit Logs</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Filter size={16} />
            Filters
          </button>
          <button
            onClick={loadLogs}
            className="flex items-center gap-2 px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={exportToCSV}
            className="flex items-center gap-2 px-3 py-2 rounded bg-blue-500 text-white hover:bg-blue-600"
          >
            <Download size={16} />
            Export
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="p-4 border rounded bg-gray-50 dark:bg-gray-900 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="User ID"
              value={filters.user || ''}
              onChange={(e) => handleFilterChange('user', e.target.value)}
              className="px-3 py-2 border rounded"
            />
            <input
              type="text"
              placeholder="Table name"
              value={filters.table || ''}
              onChange={(e) => handleFilterChange('table', e.target.value)}
              className="px-3 py-2 border rounded"
            />
            <select
              value={filters.operation || ''}
              onChange={(e) => handleFilterChange('operation', e.target.value)}
              className="px-3 py-2 border rounded"
            >
              <option value="">All operations</option>
              <option value="INSERT">INSERT</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
            </select>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.suspicious || false}
                onChange={(e) => handleFilterChange('suspicious', e.target.checked || undefined)}
                className="rounded"
              />
              Suspicious only
            </label>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900 text-red-800 dark:text-red-200 rounded">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && <div className="text-center py-8">Loading audit logs...</div>}

      {/* Table */}
      {!loading && logs.length > 0 && (
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Time</th>
                <th className="px-4 py-3 text-left font-semibold">Table</th>
                <th className="px-4 py-3 text-left font-semibold">Operation</th>
                <th className="px-4 py-3 text-left font-semibold">Record ID</th>
                <th className="px-4 py-3 text-left font-semibold">User</th>
                <th className="px-4 py-3 text-left font-semibold">IP Address</th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  onClick={() => setSelectedLog(log)}
                  className="border-b hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                >
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                    {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">{log.tableName}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        log.operation === 'DELETE'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          : log.operation === 'UPDATE'
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                            : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      }`}
                    >
                      {log.operation}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-gray-600 dark:text-gray-400">
                    {log.recordId.slice(0, 12)}...
                  </td>
                  <td className="px-4 py-3 text-sm">{log.userId || '—'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">
                    {log.ipAddress || '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {log.suspicious && (
                      <AlertTriangle size={16} className="mx-auto text-red-500" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* No results */}
      {!loading && logs.length === 0 && (
        <div className="text-center py-8 text-gray-600 dark:text-gray-400">
          No audit logs found
        </div>
      )}

      {/* Detail view */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full p-6 max-h-96 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Audit Log Details</h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-gray-700 dark:text-gray-300">Table</dt>
                <dd className="font-mono">{selectedLog.tableName}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-700 dark:text-gray-300">Operation</dt>
                <dd>{selectedLog.operation}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-700 dark:text-gray-300">Record ID</dt>
                <dd className="font-mono">{selectedLog.recordId}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-700 dark:text-gray-300">User</dt>
                <dd>{selectedLog.userId || '—'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-700 dark:text-gray-300">IP Address</dt>
                <dd className="font-mono">{selectedLog.ipAddress || '—'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-700 dark:text-gray-300">Timestamp</dt>
                <dd>{format(new Date(selectedLog.createdAt), 'yyyy-MM-dd HH:mm:ss.SSS')}</dd>
              </div>
              {selectedLog.executionTimeMs && (
                <div>
                  <dt className="font-semibold text-gray-700 dark:text-gray-300">
                    Execution Time
                  </dt>
                  <dd>{selectedLog.executionTimeMs}ms</dd>
                </div>
              )}
              {selectedLog.suspicious && (
                <div className="p-3 bg-red-50 dark:bg-red-900 rounded">
                  <dt className="font-semibold text-red-800 dark:text-red-200">
                    Suspicious Activity
                  </dt>
                  <dd className="text-red-700 dark:text-red-300">{selectedLog.suspicionReason}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
