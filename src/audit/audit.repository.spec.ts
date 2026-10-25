import { AuditRepository } from './audit.repository';
import { PrismaService } from '../database/prisma.service';

describe('AuditRepository with Prisma', () => {
  let repository: AuditRepository;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (arg: any) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        if (typeof arg === 'function') {
          return arg(mockPrisma);
        }
        return arg;
      }),
      auditRecord: {
        create: jest.fn().mockResolvedValue({ id: 'rec_1' }),
        update: jest.fn().mockResolvedValue({ id: 'rec_1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      auditOutbox: {
        create: jest.fn().mockResolvedValue({ id: 'evt_1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'evt_1' }),
      },
    };
    repository = new AuditRepository(mockPrisma as PrismaService);
  });

  it('should atomically persist audit decision and outbox record in a transaction using Prisma', async () => {
    const result = await repository.recordDecisionWithOutbox({
      tenantId: 'tenant_1',
      engagementId: 'eng_1',
      requestId: 'req_1',
      method: 'GET',
      target: 'app.example.com',
      decision: 'ALLOW',
      reason: 'IN_SCOPE',
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.auditRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant_1',
          engagementId: 'eng_1',
          decision: 'ALLOW',
          reason: 'IN_SCOPE',
        }),
      }),
    );
    expect(mockPrisma.auditOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
        }),
      }),
    );
    expect(result.auditRecordId).toBeDefined();
    expect(result.eventId).toBeDefined();
  });

  it('should throw if persistence fails', async () => {
    mockPrisma.$transaction.mockRejectedValueOnce(new Error('Transaction failed'));

    await expect(
      repository.recordDecisionWithOutbox({
        tenantId: 'tenant_1',
        engagementId: 'eng_1',
        requestId: 'req_1',
        method: 'GET',
        target: 'app.example.com',
        decision: 'ALLOW',
        reason: 'IN_SCOPE',
      }),
    ).rejects.toThrow('Transaction failed');
  });
});
