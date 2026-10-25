import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PolicyModule } from '../policy/policy.module';
import { AuditModule } from '../audit/audit.module';
import { ProxyService } from './proxy.service';
import { ProxyServer } from './proxy-server';
import { TokenBucketRateLimiter } from './rate-limiter.service';

@Module({
  imports: [IdentityModule, PolicyModule, AuditModule],
  providers: [ProxyService, ProxyServer, TokenBucketRateLimiter],
  exports: [ProxyService, ProxyServer, TokenBucketRateLimiter],
})
export class ProxyModule {}
