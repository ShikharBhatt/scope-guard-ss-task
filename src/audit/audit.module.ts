import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PolicyModule } from '../policy/policy.module';
import { AuditRepository } from './audit.repository';
import { AUDIT_SINK } from './audit.constants';
import { DefaultAuditSinkService } from './default-audit-sink.service';
import { AuditOutboxDispatcherService } from './audit-outbox-dispatcher.service';
import { AuditController } from './audit.controller';

@Module({
  imports: [IdentityModule, PolicyModule],
  controllers: [AuditController],
  providers: [
    AuditRepository,
    {
      provide: AUDIT_SINK,
      useClass: DefaultAuditSinkService,
    },
    AuditOutboxDispatcherService,
  ],
  exports: [AuditRepository, AUDIT_SINK, AuditOutboxDispatcherService],
})
export class AuditModule {}

