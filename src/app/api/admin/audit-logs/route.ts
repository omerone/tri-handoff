import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import { adminForApi } from '@/lib/auth/admin-session';
import {
  getUserAuditLog,
  getTableAuditLog,
  getRecordAuditLog,
  exportAuditLog,
  getAuditStatistics,
} from '@/lib/db/audit-queries';

/**
 * GET /api/admin/audit-logs
 *
 * Retrieve database audit logs for compliance and security monitoring
 *
 * Query parameters:
 *   - user={userId}           Filter by user who performed action
 *   - table={tableName}       Filter by affected table
 *   - operation={INSERT|UPDATE|DELETE}  Filter by operation type
 *   - suspicious=true|false   Filter by suspicious flag
 *   - record={recordId}       Get history of specific record
 *   - format=json|csv         Response format (default: json)
 *   - limit=100               Maximum records to return (default: 100, max: 1000)
 *   - offset=0                Pagination offset
 *
 * Authentication:
 *   - Super admin only (checked via session)
 *
 * Examples:
 *   GET /api/admin/audit-logs?user=user123&limit=50
 *   GET /api/admin/audit-logs?table=trades&suspicious=true
 *   GET /api/admin/audit-logs?format=csv&startDate=2024-01-01&endDate=2024-01-31
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  // The gate this route documented and did not have. It was shipped with the check commented
  // out behind a TODO, which made every mutation the product has ever made — user ids, IP
  // addresses, user agents, and the before/after of every row — readable by anyone who knew
  // the path, in JSON or as a CSV export. An audit trail that leaks is worse than no audit
  // trail: it is a second copy of the data with none of the access control of the first.
  const gate = await adminForApi();
  if (gate.response) return gate.response as NextResponse;

  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const userId = searchParams.get('user') || undefined;
    const tableName = searchParams.get('table') || undefined;
    const operation = searchParams.get('operation') || undefined;
    const suspicious = searchParams.get('suspicious') === 'true' ? true : undefined;
    const recordId = searchParams.get('record') || undefined;
    const format = searchParams.get('format') || 'json';
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 1000);
    const offset = parseInt(searchParams.get('offset') || '0');
    const startDate = searchParams.get('startDate')
      ? new Date(searchParams.get('startDate') as string)
      : undefined;
    const endDate = searchParams.get('endDate')
      ? new Date(searchParams.get('endDate') as string)
      : undefined;

    // Query audit logs based on filters
    let logs = [];

    if (recordId && tableName) {
      // Get history of specific record
      logs = await getRecordAuditLog(tableName, recordId, { limit });
    } else if (userId) {
      // Get user's audit trail
      logs = await getUserAuditLog(userId, { limit, offset });
    } else if (tableName) {
      // Get table's audit log
      logs = await getTableAuditLog(tableName, { limit, offset });
    } else {
      // Get all audit logs with filters
      logs = await exportAuditLog({
        startDate,
        endDate,
        tableName,
        userId,
        suspicious,
      });
    }

    // Apply operation filter
    if (operation) {
      logs = logs.filter((log) => log.operation === operation);
    }

    // Format response
    if (format === 'csv') {
      return formatAsCSV(logs as unknown as readonly Record<string, unknown>[]);
    }

    return NextResponse.json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit logs', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/audit-logs/statistics
 * Get audit log statistics
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const hoursBack = body.hoursBack || 24;

    const stats = await getAuditStatistics({ hoursBack });

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching audit statistics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit statistics', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Format audit logs as CSV
 */
function formatAsCSV(logs: readonly Record<string, unknown>[]): NextResponse {
  if (logs.length === 0) {
    return new NextResponse('table,operation,recordId,userId,ipAddress,createdAt\n', {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="audit-logs.csv"',
      },
    });
  }

  // Get headers from first log. Guarded by the empty-list return above; coalesced because the
  // compiler types an index read as possibly undefined.
  const headers = Object.keys(logs[0] ?? {}).filter(
    (k) => !['oldValues', 'newValues'].includes(k) // Exclude JSON columns
  );

  // Build CSV
  const csv = [
    headers.join(','),
    ...logs.map((log) =>
      headers
        .map((header) => {
          const value = log[header];
          if (value === null) return '';
          if (typeof value === 'string' && value.includes(',')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return String(value);
        })
        .join(',')
    ),
  ].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="audit-logs.csv"',
    },
  });
}

/**
 * Server-Sent Events endpoint for real-time audit log streaming
 * GET /api/admin/audit-logs?stream=true
 */
export async function setupSSE() {
  return async (request: NextRequest): Promise<NextResponse> => {
    // Check if streaming is requested
    const { searchParams } = new URL(request.url);
    if (searchParams.get('stream') !== 'true') {
      return GET(request);
    }

    // TODO: Implement Server-Sent Events for real-time audit log streaming
    // This would require a different approach with streaming responses

    return NextResponse.json({ error: 'SSE not yet implemented' }, { status: 501 });
  };
}
