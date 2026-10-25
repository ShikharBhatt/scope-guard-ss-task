import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { AuthenticatedTenant } from '../identity/identity.constants';

describe('PolicyController', () => {
  let controller: PolicyController;
  let mockPolicyService: Partial<PolicyService>;

  const mockTenant: AuthenticatedTenant = {
    id: 'tenant_abc',
    name: 'Tenant ABC',
    apiKeyId: 'key_abc',
  };

  beforeEach(() => {
    mockPolicyService = {
      createEngagement: jest.fn(),
      listEngagements: jest.fn(),
      getEngagement: jest.fn(),
      updatePolicy: jest.fn(),
      revokeEngagement: jest.fn(),
    };
    controller = new PolicyController(mockPolicyService as PolicyService);
  });

  it('should delegate createEngagement to policyService with tenant id', async () => {
    const dto = { name: 'Audit Eng', targets: [] };
    await controller.createEngagement(mockTenant, dto);
    expect(mockPolicyService.createEngagement).toHaveBeenCalledWith('tenant_abc', dto);
  });

  it('should delegate listEngagements to policyService with tenant id', async () => {
    await controller.listEngagements(mockTenant);
    expect(mockPolicyService.listEngagements).toHaveBeenCalledWith('tenant_abc');
  });

  it('should delegate getEngagement with id and tenant id', async () => {
    await controller.getEngagement(mockTenant, 'eng_123');
    expect(mockPolicyService.getEngagement).toHaveBeenCalledWith('eng_123', 'tenant_abc');
  });

  it('should delegate updatePolicy with id, tenant id and dto', async () => {
    const dto = { targets: [] };
    await controller.updatePolicy(mockTenant, 'eng_123', dto);
    expect(mockPolicyService.updatePolicy).toHaveBeenCalledWith('eng_123', 'tenant_abc', dto);
  });

  it('should delegate revokeEngagement with id and tenant id', async () => {
    await controller.revokeEngagement(mockTenant, 'eng_123');
    expect(mockPolicyService.revokeEngagement).toHaveBeenCalledWith('eng_123', 'tenant_abc');
  });
});

