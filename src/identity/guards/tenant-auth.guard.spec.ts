import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TenantAuthGuard, RequestWithTenant } from './tenant-auth.guard';
import { CryptoService } from '../crypto.service';
import { TenantRepository } from '../tenant.repository';

describe('TenantAuthGuard', () => {
  let guard: TenantAuthGuard;
  let cryptoService: CryptoService;
  let mockTenantRepo: Partial<TenantRepository>;

  beforeEach(() => {
    cryptoService = new CryptoService();
    mockTenantRepo = {
      findActiveTenantByKeyHash: jest.fn(),
    };
    guard = new TenantAuthGuard(cryptoService, mockTenantRepo as TenantRepository);
  });

  function createMockContext(headers: Record<string, string | undefined>): ExecutionContext {
    const request: RequestWithTenant = { headers };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  it('should throw UnauthorizedException when Authorization header is missing', async () => {
    const context = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Missing Authorization header'),
    );
  });

  it('should throw UnauthorizedException when auth scheme is not Bearer', async () => {
    const context = createMockContext({ authorization: 'Basic dXNlcjpwYXNz' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid Authorization header format. Expected Bearer <token>'),
    );
  });

  it('should throw UnauthorizedException when API key is invalid or revoked', async () => {
    (mockTenantRepo.findActiveTenantByKeyHash as jest.Mock).mockResolvedValue(null);
    const context = createMockContext({ authorization: 'Bearer sg_tenant_invalid_key' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid or revoked tenant API key'),
    );
  });

  it('should attach tenant to request and return true for valid API key', async () => {
    const mockTenant = {
      id: 'tenant_123',
      name: 'Test Tenant',
      apiKeyId: 'key_123',
    };
    (mockTenantRepo.findActiveTenantByKeyHash as jest.Mock).mockResolvedValue(mockTenant);

    const request: RequestWithTenant = {
      headers: { authorization: 'Bearer sg_tenant_valid_key' },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.tenant).toEqual(mockTenant);
  });
});

