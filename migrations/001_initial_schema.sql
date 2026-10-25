-- Scope Guard Database Schema Migration 001
-- Initial schema for tenants, engagements, target rules, credentials, and audit log.

CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_api_keys (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(128) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS engagements (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_engagement_tenant UNIQUE (id, tenant_id)
);

CREATE TABLE IF NOT EXISTS worker_credentials (
    id VARCHAR(64) PRIMARY KEY,
    engagement_id VARCHAR(64) NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    secret_hash VARCHAR(128) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS engagement_targets (
    id VARCHAR(64) PRIMARY KEY,
    engagement_id VARCHAR(64) NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    normalized_target VARCHAR(255) NOT NULL,
    effect VARCHAR(16) NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uq_engagement_target UNIQUE (engagement_id, normalized_target)
);

CREATE TABLE IF NOT EXISTS audit_records (
    id VARCHAR(64) PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    engagement_id VARCHAR(64) NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    request_id VARCHAR(64) NOT NULL,
    method VARCHAR(16) NOT NULL,
    target VARCHAR(255) NOT NULL,
    decision VARCHAR(16) NOT NULL CHECK (decision IN ('ALLOW', 'DENY')),
    reason VARCHAR(64) NOT NULL,
    upstream_status INTEGER,
    upstream_outcome VARCHAR(64),
    duration_ms INTEGER,
    CONSTRAINT fk_audit_engagement_tenant FOREIGN KEY (engagement_id, tenant_id) REFERENCES engagements(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_outbox (
    id VARCHAR(64) PRIMARY KEY,
    audit_record_id VARCHAR(64) NOT NULL REFERENCES audit_records(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    delivered_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Performance and lookup indexes
CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_hash ON tenant_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_engagements_tenant ON engagements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_worker_credentials_hash ON worker_credentials(secret_hash);
CREATE INDEX IF NOT EXISTS idx_engagement_targets_lookup ON engagement_targets(engagement_id, normalized_target);
CREATE INDEX IF NOT EXISTS idx_audit_records_engagement ON audit_records(engagement_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_records_tenant ON audit_records(tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_outbox_pending ON audit_outbox(status, next_retry_at) WHERE status = 'PENDING';


