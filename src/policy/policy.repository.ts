import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import * as crypto from 'crypto';
import { TargetRule } from './policy-evaluator.service';

export interface EngagementRecord {
  id: string;
  tenantId: string;
  name: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: Date;
  revokedAt: Date | null;
  targets: TargetRule[];
}

export interface EngagementWithSecretRecord extends EngagementRecord {
  workerSecret: string;
}

export interface WorkerAuthLookupResult {
  engagementId: string;
  tenantId: string;
  status: 'ACTIVE' | 'REVOKED';
  targets: TargetRule[];
}

@Injectable()
export class PolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically creates an engagement, its worker credential hash, and target rules using Prisma.
   */
  async createEngagement(
    tenantId: string,
    name: string,
    workerSecret: string,
    secretHash: string,
    targets: TargetRule[],
  ): Promise<EngagementWithSecretRecord> {
    const engagementId = `eng_${crypto.randomUUID()}`;
    const credId = `cred_${crypto.randomUUID()}`;

    const created = await this.prisma.engagement.create({
      data: {
        id: engagementId,
        tenantId,
        name,
        status: 'ACTIVE',
        workerCredentials: {
          create: {
            id: credId,
            secretHash,
          },
        },
        targets: {
          create: targets.map((t) => ({
            id: `tgt_${crypto.randomUUID()}`,
            normalizedTarget: t.normalizedTarget,
            effect: t.effect,
          })),
        },
      },
      include: {
        targets: true,
      },
    });

    return {
      id: created.id,
      tenantId: created.tenantId,
      name: created.name,
      status: created.status as 'ACTIVE' | 'REVOKED',
      createdAt: created.createdAt,
      revokedAt: created.revokedAt,
      workerSecret,
      targets: created.targets.map((t) => ({
        normalizedTarget: t.normalizedTarget,
        effect: t.effect as 'ALLOW' | 'DENY',
      })),
    };
  }

  /**
   * Retrieves all engagements for a specific tenant, strictly scoped to tenantId.
   */
  async listByTenant(tenantId: string): Promise<EngagementRecord[]> {
    const engagements = await this.prisma.engagement.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { targets: true },
    });

    return engagements.map((e) => ({
      id: e.id,
      tenantId: e.tenantId,
      name: e.name,
      status: e.status as 'ACTIVE' | 'REVOKED',
      createdAt: e.createdAt,
      revokedAt: e.revokedAt,
      targets: e.targets.map((t) => ({
        normalizedTarget: t.normalizedTarget,
        effect: t.effect as 'ALLOW' | 'DENY',
      })),
    }));
  }

  /**
   * Retrieves an engagement by ID, enforcing tenant ownership.
   */
  async findByIdAndTenant(engagementId: string, tenantId: string): Promise<EngagementRecord | null> {
    const e = await this.prisma.engagement.findFirst({
      where: {
        id: engagementId,
        tenantId,
      },
      include: {
        targets: true,
      },
    });

    if (!e) {
      return null;
    }

    return {
      id: e.id,
      tenantId: e.tenantId,
      name: e.name,
      status: e.status as 'ACTIVE' | 'REVOKED',
      createdAt: e.createdAt,
      revokedAt: e.revokedAt,
      targets: e.targets.map((t) => ({
        normalizedTarget: t.normalizedTarget,
        effect: t.effect as 'ALLOW' | 'DENY',
      })),
    };
  }

  /**
   * Replaces target policy rules for an engagement owned by tenantId in a transaction.
   */
  async replaceTargets(
    engagementId: string,
    tenantId: string,
    newTargets: TargetRule[],
  ): Promise<EngagementRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const engagement = await tx.engagement.findFirst({
        where: { id: engagementId, tenantId },
      });

      if (!engagement) {
        return null;
      }

      await tx.engagementTarget.deleteMany({
        where: { engagementId },
      });

      if (newTargets.length > 0) {
        await tx.engagementTarget.createMany({
          data: newTargets.map((t) => ({
            id: `tgt_${crypto.randomUUID()}`,
            engagementId,
            normalizedTarget: t.normalizedTarget,
            effect: t.effect,
          })),
        });
      }

      return {
        id: engagement.id,
        tenantId: engagement.tenantId,
        name: engagement.name,
        status: engagement.status as 'ACTIVE' | 'REVOKED',
        createdAt: engagement.createdAt,
        revokedAt: engagement.revokedAt,
        targets: newTargets,
      };
    });
  }

  /**
   * Revokes an engagement owned by tenantId.
   */
  async revoke(engagementId: string, tenantId: string): Promise<EngagementRecord | null> {
    const updated = await this.prisma.engagement.updateMany({
      where: { id: engagementId, tenantId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return this.findByIdAndTenant(engagementId, tenantId);
  }

  /**
   * Hot path lookup: Resolves engagement, status, and current rules by worker credential hash.
   */
  async findByWorkerSecretHash(secretHash: string): Promise<WorkerAuthLookupResult | null> {
    const cred = await this.prisma.workerCredential.findUnique({
      where: { secretHash },
      include: {
        engagement: {
          include: { targets: true },
        },
      },
    });

    if (!cred || !cred.engagement) {
      return null;
    }

    return {
      engagementId: cred.engagement.id,
      tenantId: cred.engagement.tenantId,
      status: cred.engagement.status as 'ACTIVE' | 'REVOKED',
      targets: cred.engagement.targets.map((t) => ({
        normalizedTarget: t.normalizedTarget,
        effect: t.effect as 'ALLOW' | 'DENY',
      })),
    };
  }
}
