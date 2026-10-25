import { Injectable, NotFoundException } from '@nestjs/common';
import { CryptoService } from '../identity/crypto.service';
import { TargetNormalizer } from './target-normalizer';
import { TargetRule } from './policy-evaluator.service';
import {
  EngagementRecord,
  EngagementWithSecretRecord,
  PolicyRepository,
} from './policy.repository';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';

@Injectable()
export class PolicyService {
  constructor(
    private readonly policyRepository: PolicyRepository,
    private readonly cryptoService: CryptoService,
  ) {}

  /**
   * Normalizes an array of input targets and ensures clean TargetRule mapping.
   */
  private normalizeRules(rawRules: Array<{ target: string; effect: 'ALLOW' | 'DENY' }>): TargetRule[] {
    const rulesMap = new Map<string, 'ALLOW' | 'DENY'>();

    for (const rule of rawRules) {
      const normalized = TargetNormalizer.normalize(rule.target);
      const existing = rulesMap.get(normalized);

      // If conflicting rules for the same target exist, DENY takes precedence
      if (existing === 'DENY' || rule.effect === 'DENY') {
        rulesMap.set(normalized, 'DENY');
      } else {
        rulesMap.set(normalized, 'ALLOW');
      }
    }

    return Array.from(rulesMap.entries()).map(([normalizedTarget, effect]) => ({
      normalizedTarget,
      effect,
    }));
  }

  /**
   * Creates a new engagement for the authenticated tenant.
   * Generates a high-entropy worker secret, persists only its hash, and returns
   * the plaintext secret to the caller once.
   */
  async createEngagement(
    tenantId: string,
    dto: CreateEngagementDto,
  ): Promise<EngagementWithSecretRecord> {
    const normalizedTargets = this.normalizeRules(dto.targets || []);
    const workerSecret = this.cryptoService.generateWorkerToken();
    const workerSecretHash = this.cryptoService.hashToken(workerSecret);

    return this.policyRepository.createEngagement(
      tenantId,
      dto.name.trim(),
      workerSecret,
      workerSecretHash,
      normalizedTargets,
    );
  }

  /**
   * Lists all engagements for the authenticated tenant.
   */
  async listEngagements(tenantId: string): Promise<EngagementRecord[]> {
    return this.policyRepository.listByTenant(tenantId);
  }

  /**
   * Retrieves a specific engagement owned by the authenticated tenant.
   * Enforces tenant isolation: Returns 404 if not found or belongs to another tenant.
   */
  async getEngagement(engagementId: string, tenantId: string): Promise<EngagementRecord> {
    const engagement = await this.policyRepository.findByIdAndTenant(engagementId, tenantId);
    if (!engagement) {
      throw new NotFoundException(`Engagement ${engagementId} not found`);
    }
    return engagement;
  }

  /**
   * Updates target scope rules for an engagement owned by the authenticated tenant.
   */
  async updatePolicy(
    engagementId: string,
    tenantId: string,
    dto: UpdatePolicyDto,
  ): Promise<EngagementRecord> {
    const normalizedTargets = this.normalizeRules(dto.targets || []);
    const updated = await this.policyRepository.replaceTargets(
      engagementId,
      tenantId,
      normalizedTargets,
    );
    if (!updated) {
      throw new NotFoundException(`Engagement ${engagementId} not found`);
    }
    return updated;
  }

  /**
   * Revokes an engagement owned by the authenticated tenant.
   */
  async revokeEngagement(engagementId: string, tenantId: string): Promise<EngagementRecord> {
    const revoked = await this.policyRepository.revoke(engagementId, tenantId);
    if (!revoked) {
      throw new NotFoundException(`Engagement ${engagementId} not found`);
    }
    return revoked;
  }
}

