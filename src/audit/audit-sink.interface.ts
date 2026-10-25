export interface AuditSink {
  /**
   * Delivers an audit event to a downstream sink (e.g. logging service, webhook, or external SIEM).
   * Throws an error if the sink is unavailable or rejects the event.
   */
  deliver(event: {
    eventId: string;
    auditRecordId: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

