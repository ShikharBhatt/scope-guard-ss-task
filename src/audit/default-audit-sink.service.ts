import { Injectable, Logger } from '@nestjs/common';
import { AuditSink } from './audit-sink.interface';

@Injectable()
export class DefaultAuditSinkService implements AuditSink {
  private readonly logger = new Logger('DownstreamAuditSink');

  async deliver(event: {
    eventId: string;
    auditRecordId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    this.logger.log(
      `[SinkDelivery] Event=${event.eventId} Record=${event.auditRecordId} Decision=${event.payload['decision']} Target=${event.payload['target']}`,
    );
  }
}

