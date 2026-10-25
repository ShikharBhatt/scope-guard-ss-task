export interface AuditRecordItem {
  id: string;
  timestamp: Date;
  tenantId: string;
  engagementId: string;
  requestId: string;
  method: string;
  target: string;
  decision: 'ALLOW' | 'DENY';
  reason: string;
  upstreamStatus: number | null;
  upstreamOutcome: string | null;
  durationMs: number | null;
}

export interface OutboxItem {
  id: string;
  auditRecordId: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  retryCount: number;
  nextRetryAt: Date;
  lastError: string | null;
}

export const AUDIT_SINK = 'AUDIT_SINK';

