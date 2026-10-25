import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { CryptoService } from '../crypto.service';
import { TenantRepository } from '../tenant.repository';
import { AuthenticatedTenant } from '../identity.constants';

export interface RequestWithTenant {
  headers: Record<string, string | string[] | undefined>;
  tenant?: AuthenticatedTenant;
}

@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(
    private readonly cryptoService: CryptoService,
    private readonly tenantRepository: TenantRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid Authorization header format. Expected Bearer <token>');
    }

    const keyHash = this.cryptoService.hashToken(token);
    const tenant = await this.tenantRepository.findActiveTenantByKeyHash(keyHash);

    if (!tenant) {
      throw new UnauthorizedException('Invalid or revoked tenant API key');
    }

    request.tenant = tenant;
    return true;
  }
}

