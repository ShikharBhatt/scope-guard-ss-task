import { HealthController } from './health.controller';
import { PrismaService } from '../database/prisma.service';
import { ServiceUnavailableException } from '@nestjs/common';

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrisma: Partial<PrismaService>;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };

    controller = new HealthController(mockPrisma as PrismaService);
  });

  it('should return 200 ok when database query succeeds', async () => {
    const response = await controller.check();

    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(response.status).toBe('ok');
    expect(response.database).toBe('connected');
    expect(typeof response.timestamp).toBe('string');
  });

  it('should throw ServiceUnavailableException when database fails', async () => {
    (mockPrisma.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
    try {
      await controller.check();
    } catch (err: unknown) {
      const error = err as ServiceUnavailableException;
      const res = error.getResponse() as Record<string, unknown>;
      expect(res.status).toBe('error');
      expect(res.database).toBe('disconnected');
    }
  });
});
