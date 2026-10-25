#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo "    Running Scope Guard Multi-Tenant Isolation Tests        "
echo "============================================================"

# 1. Run unit/integration tenant isolation tests
echo "[1/2] Running Jest Unit/Integration Tenant Isolation Suite..."
npx jest --testPathPattern=tenant-isolation

# 2. Run Live Two-Tenant End-to-End Isolation Verification
echo "[2/2] Running Live Two-Tenant Isolation Against Running API..."
npx ts-node scripts/test-tenant-isolation.ts

echo "All multi-tenant isolation tests passed successfully!"
