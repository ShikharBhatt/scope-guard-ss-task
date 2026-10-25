import { Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { TenantRepository } from './tenant.repository';
import { TenantAuthGuard } from './guards/tenant-auth.guard';

@Module({
  providers: [CryptoService, TenantRepository, TenantAuthGuard],
  exports: [CryptoService, TenantRepository, TenantAuthGuard],
})
export class IdentityModule {}

