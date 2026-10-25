import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  database: 'connected' | 'disconnected';
}

@ApiTags('Health')
@Controller({
  path: 'health',
  version: '1',
})
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'System health check and database connectivity probe',
    description: 'Returns HTTP 200 when Scope Guard and PostgreSQL are operational. Returns 503 if the database is unreachable.',
  })
  @ApiResponse({
    status: 200,
    description: 'System healthy and database connected',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2026-10-25T08:30:00.000Z',
        database: 'connected',
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Service unavailable / database disconnected',
    schema: {
      example: {
        status: 'error',
        timestamp: '2026-10-25T08:30:00.000Z',
        database: 'disconnected',
      },
    },
  })
  async check(): Promise<HealthCheckResponse> {
    const timestamp = new Date().toISOString();
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        timestamp,
        database: 'connected',
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp,
        database: 'disconnected',
      });
    }
  }
}
