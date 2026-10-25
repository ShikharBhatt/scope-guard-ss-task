import { PolicyService } from '../src/policy/policy.service';
import { PolicyRepository } from '../src/policy/policy.repository';
import { CryptoService } from '../src/identity/crypto.service';
import { NotFoundException } from '@nestjs/common';

describe('Tenant Isolation Verification', () => {
  let policyService: PolicyService;
  let mockPolicyRepo: Partial<PolicyRepository>;

  const TENANT_A = 'tenant_alpha';
  const TENANT_B = 'tenant_beta';

  beforeEach(() => {
    mockPolicyRepo = {
      findByIdAndTenant: jest.fn().mockImplementation((engId: string, tenantId: string) => {
        // Engagement 'eng_b_1' belongs ONLY to Tenant B
        if (engId === 'eng_b_1' && tenantId === TENANT_B) {
          return Promise.resolve({
            id: 'eng_b_1',
            tenantId: TENANT_B,
            name: "Tenant B's Private Engagement",
            status: 'ACTIVE',
            createdAt: new Date(),
            revokedAt: null,
            targets: [],
          });
        }
        // If Tenant A attempts to access Tenant B's engagement, repository returns null
        return Promise.resolve(null);
      }),
      replaceTargets: jest.fn().mockImplementation((engId: string, tenantId: string) => {
        if (engId === 'eng_b_1' && tenantId === TENANT_B) {
          return Promise.resolve({
            id: 'eng_b_1',
            tenantId: TENANT_B,
            name: "Tenant B's Private Engagement",
            status: 'ACTIVE',
            createdAt: new Date(),
            revokedAt: null,
            targets: [],
          });
        }
        return Promise.resolve(null);
      }),
      revoke: jest.fn().mockImplementation((engId: string, tenantId: string) => {
        if (engId === 'eng_b_1' && tenantId === TENANT_B) {
          return Promise.resolve({
            id: 'eng_b_1',
            tenantId: TENANT_B,
            name: "Tenant B's Private Engagement",
            status: 'REVOKED',
            createdAt: new Date(),
            revokedAt: new Date(),
            targets: [],
          });
        }
        return Promise.resolve(null);
      }),
    };

    policyService = new PolicyService(
      mockPolicyRepo as PolicyRepository,
      new CryptoService(),
    );
  });

  it('proves Tenant A cannot read Tenant B engagement', async () => {
    // Tenant B can read its own engagement
    const engagementB = await policyService.getEngagement('eng_b_1', TENANT_B);
    expect(engagementB).toBeDefined();
    expect(engagementB.id).toBe('eng_b_1');

    // Tenant A attempting to read Tenant B's engagement is rejected with 404
    await expect(policyService.getEngagement('eng_b_1', TENANT_A)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('proves Tenant A cannot modify policy of Tenant B engagement', async () => {
    await expect(
      policyService.updatePolicy('eng_b_1', TENANT_A, {
        targets: [{ target: 'malicious.attacker.com', effect: 'ALLOW' }],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('proves Tenant A cannot revoke Tenant B engagement', async () => {
    await expect(policyService.revokeEngagement('eng_b_1', TENANT_A)).rejects.toThrow(
      NotFoundException,
    );
  });
});

