#!/usr/bin/env bash
set -euo pipefail

echo "Running Scope Guard Scope Tests..."
npm test -- -t "Scope|target|Target"

