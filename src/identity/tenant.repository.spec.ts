import { TenantRepository } from './tenant.repository';
import { PrismaService } from '../database/prisma.service';

describe('TenantRepository with Prisma', () => {
  let repository: TenantRepository;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tenantApiKey: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
      tenant: {
        upsert: jest.fn(),
      },
    };
    repository = new TenantRepository(mockPrisma as PrismaService);
  });

  it('should query active tenant by key hash using Prisma and return mapped object', async () => {
    mockPrisma.tenantApiKey.findFirst.mockResolvedValueOnce({
      id: 'k1',
      keyHash: 'test_hash',
      tenant: {
        id: 't1',
        name: 'Tenant One',
      },
    });

    const tenant = await repository.findActiveTenantByKeyHash('test_hash');

    expect(mockPrisma.tenantApiKey.findFirst).toHaveBeenCalledWith({
      where: {
        keyHash: 'test_hash',
        revokedAt: null,
      },
      include: {
        tenant: true,
      },
    });
    expect(tenant).toEqual({
      id: 't1',
      name: 'Tenant One',
      apiKeyId: 'k1',
    });
  });

  it('should return null if no active tenant is found for key hash', async () => {
    mockPrisma.tenantApiKey.findFirst.mockResolvedValueOnce(null);

    const tenant = await repository.findActiveTenantByKeyHash('unknown_hash');
    expect(tenant).toBeNull();
  });
});
