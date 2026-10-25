import { PolicyService } from './policy.service';
import { PolicyRepository } from './policy.repository';
import { CryptoService } from '../identity/crypto.service';
import { NotFoundException } from '@nestjs/common';

describe('PolicyService', () => {
  let service: PolicyService;
  let mockPolicyRepo: Partial<PolicyRepository>;
  let cryptoService: CryptoService;

  beforeEach(() => {
    cryptoService = new CryptoService();
    mockPolicyRepo = {
      createEngagement: jest.fn(),
      listByTenant: jest.fn(),
      findByIdAndTenant: jest.fn(),
      replaceTargets: jest.fn(),
      revoke: jest.fn(),
    };

    service = new PolicyService(mockPolicyRepo as PolicyRepository, cryptoService);
  });

  it('should create engagement, normalize targets, and hash worker secret', async () => {
    const mockCreated = {
      id: 'eng_1',
      tenantId: 'tenant_1',
      name: 'Pentest Project',
      status: 'ACTIVE' as const,
      createdAt: new Date(),
      revokedAt: null,
      workerSecret: 'sg_worker_mock',
      targets: [{ normalizedTarget: 'api.example.com:443', effect: 'ALLOW' as const }],
    };

    (mockPolicyRepo.createEngagement as jest.Mock).mockResolvedValue(mockCreated);

    const result = await service.createEngagement('tenant_1', {
      name: 'Pentest Project',
      targets: [{ target: 'https://API.EXAMPLE.COM:443/test', effect: 'ALLOW' }],
    });

    expect(mockPolicyRepo.createEngagement).toHaveBeenCalledWith(
      'tenant_1',
      'Pentest Project',
      expect.stringMatching(/^sg_worker_/),
      expect.any(String), // secret hash
      [{ normalizedTarget: 'api.example.com:443', effect: 'ALLOW' }],
    );
    expect(result.workerSecret).toBeDefined();
  });

  it('should resolve conflicting target rules with DENY precedence', async () => {
    (mockPolicyRepo.createEngagement as jest.Mock).mockResolvedValue({ id: 'eng_1' });

    await service.createEngagement('tenant_1', {
      name: 'Conflicting Pentest',
      targets: [
        { target: 'example.com', effect: 'ALLOW' },
        { target: 'EXAMPLE.COM', effect: 'DENY' },
      ],
    });

    expect(mockPolicyRepo.createEngagement).toHaveBeenCalledWith(
      'tenant_1',
      'Conflicting Pentest',
      expect.any(String),
      expect.any(String),
      [{ normalizedTarget: 'example.com', effect: 'DENY' }],
    );
  });

  it('should throw NotFoundException when engagement not found on read', async () => {
    (mockPolicyRepo.findByIdAndTenant as jest.Mock).mockResolvedValue(null);

    await expect(service.getEngagement('eng_unknown', 'tenant_1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should update policy with normalized targets', async () => {
    const mockUpdated = {
      id: 'eng_1',
      tenantId: 'tenant_1',
      name: 'Pentest',
      status: 'ACTIVE' as const,
      createdAt: new Date(),
      revokedAt: null,
      targets: [{ normalizedTarget: 'new.target.com', effect: 'ALLOW' as const }],
    };
    (mockPolicyRepo.replaceTargets as jest.Mock).mockResolvedValue(mockUpdated);

    const result = await service.updatePolicy('eng_1', 'tenant_1', {
      targets: [{ target: 'NEW.TARGET.COM.', effect: 'ALLOW' }],
    });

    expect(mockPolicyRepo.replaceTargets).toHaveBeenCalledWith('eng_1', 'tenant_1', [
      { normalizedTarget: 'new.target.com', effect: 'ALLOW' },
    ]);
    expect(result.targets[0]?.normalizedTarget).toBe('new.target.com');
  });

  it('should revoke an engagement', async () => {
    const mockRevoked = {
      id: 'eng_1',
      tenantId: 'tenant_1',
      name: 'Pentest',
      status: 'REVOKED' as const,
      createdAt: new Date(),
      revokedAt: new Date(),
      targets: [],
    };
    (mockPolicyRepo.revoke as jest.Mock).mockResolvedValue(mockRevoked);

    const result = await service.revokeEngagement('eng_1', 'tenant_1');
    expect(result.status).toBe('REVOKED');
  });
});

