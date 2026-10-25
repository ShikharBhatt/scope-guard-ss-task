import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedTenant } from '../identity.constants';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedTenant => {
    const request = ctx.switchToHttp().getRequest<{ tenant: AuthenticatedTenant }>();
    return request.tenant;
  },
);

