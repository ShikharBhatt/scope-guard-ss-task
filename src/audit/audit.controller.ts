import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { TenantAuthGuard } from '../identity/guards/tenant-auth.guard';
import { CurrentTenant } from '../identity/decorators/current-tenant.decorator';
import { AuthenticatedTenant } from '../identity/identity.constants';
import { AuditRepository, PaginatedAuditResult } from './audit.repository';
import { PolicyRepository } from '../policy/policy.repository';

@ApiTags('Audit')
@ApiBearerAuth('tenant-auth')
@Controller({
  path: 'engagements',
  version: '1',
})
@UseGuards(TenantAuthGuard)
export class AuditController {
  constructor(
    private readonly auditRepository: AuditRepository,
    private readonly policyRepository: PolicyRepository,
  ) {}

  @Get(':id/audit')
  @ApiOperation({
    summary: 'List durable audit records for an engagement',
    description:
      'Retrieves the chronological audit log of all authorization decisions (ALLOW, DENY), timestamps, targets, decision reasons, and upstream outcomes for the specified engagement. Enforces tenant ownership.',
  })
  @ApiParam({
    name: 'id',
    description: 'Engagement ID',
    example: 'eng_b93d6d5c-9c71-48e0-a7d1-37f26c2cf42b',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of audit records to return (1 to 100, default: 20)',
    example: 20,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of audit records to skip for pagination (default: 0)',
    example: 0,
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated audit records',
    schema: {
      example: {
        total: 5,
        limit: 20,
        offset: 0,
        items: [
          {
            id: 'audit_c1e3428f-7d1a-4f51-bfa0-68e1a12f5a6b',
            timestamp: '2026-10-25T08:35:00.000Z',
            tenantId: 'tenant_demo_01',
            engagementId: 'eng_b93d6d5c-9c71-48e0-a7d1-37f26c2cf42b',
            requestId: 'req_84d720a4-fa06-4447-9750-717dafa531b9',
            method: 'GET',
            target: 'app.dev.example.com',
            decision: 'ALLOW',
            reason: 'IN_SCOPE',
            upstreamStatus: 200,
            upstreamOutcome: 'UPSTREAM_SUCCESS',
            durationMs: 42,
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid pagination query parameters (limit / offset)',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Engagement not found or belongs to another tenant',
  })
  async getEngagementAudit(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ): Promise<PaginatedAuditResult> {
    // Enforce tenant isolation: verify engagement belongs to authenticated tenant
    const engagement = await this.policyRepository.findByIdAndTenant(id, tenant.id);
    if (!engagement) {
      throw new NotFoundException(`Engagement ${id} not found`);
    }

    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    if (isNaN(limit) || limit <= 0 || limit > 100) {
      throw new BadRequestException('limit must be an integer between 1 and 100');
    }

    if (isNaN(offset) || offset < 0) {
      throw new BadRequestException('offset must be a non-negative integer');
    }

    return this.auditRepository.listByEngagementAndTenant(id, tenant.id, limit, offset);
  }
}
