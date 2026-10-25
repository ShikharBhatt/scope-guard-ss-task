export const WORKER_TOKEN_PREFIX = 'sg_worker_';
export const TENANT_TOKEN_PREFIX = 'sg_tenant_';

export interface AuthenticatedTenant {
  id: string;
  name: string;
  apiKeyId: string;
}

export interface WorkerIdentity {
  engagementId: string;
  tenantId: string;
  engagementStatus: 'ACTIVE' | 'REVOKED';
}

