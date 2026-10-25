import { AuditOutboxDispatcherService } from './audit-outbox-dispatcher.service';
import { AuditRepository } from './audit.repository';
import { AuditSink } from './audit-sink.interface';
import { OutboxItem } from './audit.constants';

describe('AuditOutboxDispatcherService', () => {
  let dispatcher: AuditOutboxDispatcherService;
  let mockAuditRepo: Partial<AuditRepository>;
  let mockAuditSink: Partial<AuditSink>;

  beforeEach(() => {
    mockAuditRepo = {
      fetchPendingOutbox: jest.fn(),
      markOutboxDelivered: jest.fn(),
      markOutboxFailed: jest.fn(),
    };
    mockAuditSink = {
      deliver: jest.fn(),
    };

    dispatcher = new AuditOutboxDispatcherService(
      mockAuditRepo as AuditRepository,
      mockAuditSink as AuditSink,
    );
  });

  afterEach(() => {
    dispatcher.onApplicationShutdown();
  });

  it('should deliver pending events and mark them as DELIVERED', async () => {
    const mockItem: OutboxItem = {
      id: 'evt_1',
      auditRecordId: 'rec_1',
      payload: { decision: 'ALLOW', target: 'api.example.com' },
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: new Date(),
      lastError: null,
    };

    (mockAuditRepo.fetchPendingOutbox as jest.Mock).mockResolvedValue([mockItem]);
    (mockAuditSink.deliver as jest.Mock).mockResolvedValue(undefined);

    const count = await dispatcher.dispatchBatch();

    expect(count).toBe(1);
    expect(mockAuditSink.deliver).toHaveBeenCalledWith({
      eventId: 'evt_1',
      auditRecordId: 'rec_1',
      payload: mockItem.payload,
    });
    expect(mockAuditRepo.markOutboxDelivered).toHaveBeenCalledWith('evt_1');
  });

  it('should schedule retry with backoff when downstream sink fails', async () => {
    const mockItem: OutboxItem = {
      id: 'evt_fail_1',
      auditRecordId: 'rec_2',
      payload: { decision: 'ALLOW' },
      status: 'PENDING',
      retryCount: 1,
      nextRetryAt: new Date(),
      lastError: null,
    };

    (mockAuditRepo.fetchPendingOutbox as jest.Mock).mockResolvedValue([mockItem]);
    (mockAuditSink.deliver as jest.Mock).mockRejectedValue(new Error('Sink connection refused'));

    const count = await dispatcher.dispatchBatch();

    expect(count).toBe(0);
    expect(mockAuditRepo.markOutboxFailed).toHaveBeenCalledWith(
      'evt_fail_1',
      'Sink connection refused',
      expect.any(Date),
    );
  });
});

