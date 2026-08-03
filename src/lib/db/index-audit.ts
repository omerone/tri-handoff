/**
 * Audit Logging Exports
 *
 * Central export point for audit logging functionality
 * Used by: API endpoints, admin pages, scheduled jobs
 */

export {
  getUserAuditLog,
  getTableAuditLog,
  getRecordAuditLog,
  getSuspiciousActivity,
  getSlowQueries,
  getDataAccessLog,
  getActivityByIP,
  getRecentActivity,
  exportAuditLog,
  getAuditStatistics,
  archiveOldAuditLogs,
  deleteArchivedLogs,
} from '@/lib/db/audit-queries';

export { auditExtension, getSuspiciousActivity as getSuspiciousActivityMiddleware } from '@/lib/db/audit-middleware';
