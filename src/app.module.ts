import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadConfiguration } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { PolicyModule } from './policy/policy.module';
import { AuditModule } from './audit/audit.module';
import { ProxyModule } from './proxy/proxy.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfiguration],
    }),
    DatabaseModule,
    IdentityModule,
    PolicyModule,
    AuditModule,
    ProxyModule,
    HealthModule,
  ],
})
export class AppModule {}

