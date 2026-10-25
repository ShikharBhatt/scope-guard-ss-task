#!/usr/bin/env bash
set -euo pipefail

echo "Running Scope Guard Revocation Tests..."
npm test -- -t "revocation|Revocation|revoke|REVOKED"

