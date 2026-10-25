import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { TargetNormalizer } from './target-normalizer';
import { PolicyEvaluatorService } from './policy-evaluator.service';
import { PolicyRepository } from './policy.repository';
import { PolicyService } from './policy.service';
import { PolicyController } from './policy.controller';

@Module({
  imports: [IdentityModule],
  controllers: [PolicyController],
  providers: [
    TargetNormalizer,
    PolicyEvaluatorService,
    PolicyRepository,
    PolicyService,
  ],
  exports: [PolicyEvaluatorService, PolicyRepository, PolicyService],
})
export class PolicyModule {}

