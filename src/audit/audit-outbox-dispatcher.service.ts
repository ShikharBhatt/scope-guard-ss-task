import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { AuditRepository } from './audit.repository';
import { AUDIT_SINK } from './audit.constants';
import { AuditSink } from './audit-sink.interface';

@Injectable()
export class AuditOutboxDispatcherService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AuditOutboxDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly auditRepository: AuditRepository,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
  ) {}

  onApplicationBootstrap(): void {
    // Start background poller every 2000ms
    this.timer = setInterval(() => {
      this.dispatchBatch().catch((err) => {
        this.logger.error('Error during outbox dispatch cycle', err.stack);
      });
    }, 2000);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Executes a single dispatch batch of pending outbox events.
   * Can be called directly by tests to deterministically verify outbox delivery and retry behavior.
   */
  async dispatchBatch(batchSize: number = 20): Promise<number> {
    if (this.isProcessing) {
      return 0;
    }

    this.isProcessing = true;
    let deliveredCount = 0;

    try {
      const items = await this.auditRepository.fetchPendingOutbox(batchSize);

      for (const item of items) {
        try {
          await this.auditSink.deliver({
            eventId: item.id,
            auditRecordId: item.auditRecordId,
            payload: item.payload,
          });

          await this.auditRepository.markOutboxDelivered(item.id);
          deliveredCount++;
        } catch (error) {
          const errorMessage = (error as Error).message || 'Unknown sink error';
          // Bounded exponential backoff: 1s, 2s, 4s, 8s, up to 60s
          const backoffMs = Math.min(60000, 1000 * Math.pow(2, item.retryCount));
          const nextRetryAt = new Date(Date.now() + backoffMs);

          this.logger.warn(
            `Failed to deliver audit outbox event ${item.id} (attempt ${item.retryCount + 1}): ${errorMessage}. Next retry at ${nextRetryAt.toISOString()}`,
          );

          await this.auditRepository.markOutboxFailed(item.id, errorMessage, nextRetryAt);
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return deliveredCount;
  }
}

