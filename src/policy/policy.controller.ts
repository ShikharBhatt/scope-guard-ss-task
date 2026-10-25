import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { TenantAuthGuard } from '../identity/guards/tenant-auth.guard';
import { CurrentTenant } from '../identity/decorators/current-tenant.decorator';
import { AuthenticatedTenant } from '../identity/identity.constants';
import { PolicyService } from './policy.service';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';
import { EngagementRecord, EngagementWithSecretRecord } from './policy.repository';

@ApiTags('Engagements')
@ApiBearerAuth('tenant-auth')
@Controller({
  path: 'engagements',
  version: '1',
})
@UseGuards(TenantAuthGuard)
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new engagement and provision worker credentials',
    description:
      'Creates a tenant-scoped engagement with initial target rules. Generates a 256-bit cryptographically secure worker secret, returning the plaintext once while storing its SHA-256 hash at rest.',
  })
  @ApiResponse({
    status: 201,
    description: 'Engagement created and worker token issued',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input (e.g., malformed target, wildcard in target, userinfo)',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized (invalid or missing tenant API key)',
  })
  async createEngagement(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Body() dto: CreateEngagementDto,
  ): Promise<EngagementWithSecretRecord> {
    return this.policyService.createEngagement(tenant.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all engagements belonging to the authenticated tenant',
    description: 'Returns all active and revoked engagements owned exclusively by the caller tenant.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of engagements',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async listEngagements(
    @CurrentTenant() tenant: AuthenticatedTenant,
  ): Promise<EngagementRecord[]> {
    return this.policyService.listEngagements(tenant.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get engagement details by ID',
    description: 'Fetches engagement status and normalized target rules. Enforces tenant isolation.',
  })
  @ApiParam({
    name: 'id',
    description: 'Engagement ID (e.g., eng_b93d6d5c-...)',
    example: 'eng_b93d6d5c-9c71-48e0-a7d1-37f26c2cf42b',
  })
  @ApiResponse({
    status: 200,
    description: 'Engagement details',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Engagement not found or belongs to another tenant',
  })
  async getEngagement(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
  ): Promise<EngagementRecord> {
    return this.policyService.getEngagement(id, tenant.id);
  }

  @Patch(':id/policy')
  @ApiOperation({
    summary: 'Update or append target scope rules for an engagement',
    description: 'Normalizes and adds new targets to the engagement. Deny rules take precedence over allow rules.',
  })
  @ApiParam({
    name: 'id',
    description: 'Engagement ID',
    example: 'eng_b93d6d5c-9c71-48e0-a7d1-37f26c2cf42b',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated engagement policy',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid targets or engagement is already REVOKED',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Engagement not found',
  })
  async updatePolicy(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
    @Body() dto: UpdatePolicyDto,
  ): Promise<EngagementRecord> {
    return this.policyService.updatePolicy(id, tenant.id, dto);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Immediately revoke an engagement',
    description:
      'Marks the engagement as REVOKED. Every proxy authorization check evaluating after this transaction commits will immediately fail with HTTP 403 ENGAGEMENT_REVOKED.',
  })
  @ApiParam({
    name: 'id',
    description: 'Engagement ID',
    example: 'eng_b93d6d5c-9c71-48e0-a7d1-37f26c2cf42b',
  })
  @ApiResponse({
    status: 200,
    description: 'Engagement successfully revoked',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Engagement not found',
  })
  async revokeEngagement(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
  ): Promise<EngagementRecord> {
    return this.policyService.revokeEngagement(id, tenant.id);
  }
}
