#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

compose_args=(-f docker-compose.yml)

if [[ -n "${DOCKER_SHARED_NETWORK:-}" ]]; then
  compose_args+=(-f docker-compose.shared-network.yml)
fi

exec docker compose "${compose_args[@]}" "$@"
