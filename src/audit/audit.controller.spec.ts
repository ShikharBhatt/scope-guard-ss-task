import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { PolicyRepository } from '../policy/policy.repository';
import { AuthenticatedTenant } from '../identity/identity.constants';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('AuditController', () => {
  let controller: AuditController;
  let mockAuditRepo: Partial<AuditRepository>;
  let mockPolicyRepo: Partial<PolicyRepository>;

  const mockTenant: AuthenticatedTenant = {
    id: 'tenant_1',
    name: 'Tenant 1',
    apiKeyId: 'key_1',
  };

  beforeEach(() => {
    mockAuditRepo = {
      listByEngagementAndTenant: jest.fn(),
    };
    mockPolicyRepo = {
      findByIdAndTenant: jest.fn(),
    };
    controller = new AuditController(
      mockAuditRepo as AuditRepository,
      mockPolicyRepo as PolicyRepository,
    );
  });

  it('should return paginated audit records for valid engagement owned by tenant', async () => {
    (mockPolicyRepo.findByIdAndTenant as jest.Mock).mockResolvedValue({
      id: 'eng_1',
      tenantId: 'tenant_1',
    });
    (mockAuditRepo.listByEngagementAndTenant as jest.Mock).mockResolvedValue({
      total: 1,
      limit: 20,
      offset: 0,
      items: [],
    });

    const result = await controller.getEngagementAudit(mockTenant, 'eng_1', '20', '0');

    expect(mockPolicyRepo.findByIdAndTenant).toHaveBeenCalledWith('eng_1', 'tenant_1');
    expect(mockAuditRepo.listByEngagementAndTenant).toHaveBeenCalledWith(
      'eng_1',
      'tenant_1',
      20,
      0,
    );
    expect(result.total).toBe(1);
  });

  it('should throw NotFoundException if engagement belongs to another tenant (tenant isolation)', async () => {
    (mockPolicyRepo.findByIdAndTenant as jest.Mock).mockResolvedValue(null);

    await expect(controller.getEngagementAudit(mockTenant, 'eng_other', '20', '0')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw BadRequestException if limit is invalid or exceeds bounds', async () => {
    (mockPolicyRepo.findByIdAndTenant as jest.Mock).mockResolvedValue({
      id: 'eng_1',
      tenantId: 'tenant_1',
    });

    await expect(controller.getEngagementAudit(mockTenant, 'eng_1', '500', '0')).rejects.toThrow(
      BadRequestException,
    );
  });
});

