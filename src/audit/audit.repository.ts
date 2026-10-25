import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { AuditRecordItem, OutboxItem } from './audit.constants';

export interface RecordDecisionParams {
  tenantId: string;
  engagementId: string;
  requestId: string;
  method: string;
  target: string;
  decision: 'ALLOW' | 'DENY';
  reason: string;
}

export interface RecordDecisionResult {
  auditRecordId: string;
  eventId: string;
}

export interface PaginatedAuditResult {
  total: number;
  limit: number;
  offset: number;
  items: AuditRecordItem[];
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically persists an authorization decision and a durable outbox event in a single Prisma transaction.
   * If this transaction fails, the caller MUST fail closed.
   */
  async recordDecisionWithOutbox(params: RecordDecisionParams): Promise<RecordDecisionResult> {
    const auditRecordId = `audit_${crypto.randomUUID()}`;
    const eventId = `evt_${crypto.randomUUID()}`;

    const payload = {
      auditRecordId,
      tenantId: params.tenantId,
      engagementId: params.engagementId,
      requestId: params.requestId,
      method: params.method,
      target: params.target,
      decision: params.decision,
      reason: params.reason,
      timestamp: new Date().toISOString(),
    };

    await this.prisma.$transaction([
      this.prisma.auditRecord.create({
        data: {
          id: auditRecordId,
          tenantId: params.tenantId,
          engagementId: params.engagementId,
          requestId: params.requestId,
          method: params.method,
          target: params.target,
          decision: params.decision,
          reason: params.reason,
        },
      }),
      this.prisma.auditOutbox.create({
        data: {
          id: eventId,
          auditRecordId,
          payload: payload as Prisma.InputJsonValue,
          status: 'PENDING',
          retryCount: 0,
          nextRetryAt: new Date(),
        },
      }),
    ]);

    return { auditRecordId, eventId };
  }

  /**
   * Updates an audit record with upstream execution outcome and timing.
   */
  async updateUpstreamOutcome(
    auditRecordId: string,
    upstreamStatus: number | null,
    upstreamOutcome: string,
    durationMs: number,
  ): Promise<void> {
    await this.prisma.auditRecord.update({
      where: { id: auditRecordId },
      data: {
        upstreamStatus,
        upstreamOutcome,
        durationMs,
      },
    });
  }

  /**
   * Fetches pending outbox events for asynchronous delivery to the downstream sink.
   */
  async fetchPendingOutbox(batchSize: number = 20): Promise<OutboxItem[]> {
    const rows = await this.prisma.auditOutbox.findMany({
      where: {
        status: 'PENDING',
        nextRetryAt: { lte: new Date() },
      },
      orderBy: { nextRetryAt: 'asc' },
      take: batchSize,
    });

    return rows.map((r) => ({
      id: r.id,
      auditRecordId: r.auditRecordId,
      payload: r.payload as Record<string, unknown>,
      status: r.status as 'PENDING' | 'DELIVERED' | 'FAILED',
      retryCount: r.retryCount,
      nextRetryAt: r.nextRetryAt,
      lastError: r.lastError,
    }));
  }

  /**
   * Marks an outbox event as successfully delivered.
   */
  async markOutboxDelivered(eventId: string): Promise<void> {
    await this.prisma.auditOutbox.update({
      where: { id: eventId },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    });
  }

  /**
   * Records a failed delivery attempt and schedules next retry with exponential backoff.
   */
  async markOutboxFailed(eventId: string, error: string, nextRetryAt: Date): Promise<void> {
    await this.prisma.auditOutbox.update({
      where: { id: eventId },
      data: {
        retryCount: { increment: 1 },
        lastError: error.substring(0, 500),
        nextRetryAt,
      },
    });
  }

  /**
   * Lists audit records for an engagement, strictly scoped to the authenticated tenant.
   */
  async listByEngagementAndTenant(
    engagementId: string,
    tenantId: string,
    limit: number,
    offset: number,
  ): Promise<PaginatedAuditResult> {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditRecord.count({
        where: { engagementId, tenantId },
      }),
      this.prisma.auditRecord.findMany({
        where: { engagementId, tenantId },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return {
      total,
      limit,
      offset,
      items: items.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        tenantId: r.tenantId,
        engagementId: r.engagementId,
        requestId: r.requestId,
        method: r.method,
        target: r.target,
        decision: r.decision as 'ALLOW' | 'DENY',
        reason: r.reason,
        upstreamStatus: r.upstreamStatus,
        upstreamOutcome: r.upstreamOutcome,
        durationMs: r.durationMs,
      })),
    };
  }
}
