#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

load_env_var() {
  local file=$1 key=$2
  [[ -f "$file" ]] || return 0
  [[ -n "${!key:-}" ]] && return 0
  local line
  line=$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n1 || true)
  [[ -n "$line" ]] || return 0
  local value=${line#*=}
  value=${value//$'\r'/}
  value=$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")
  export "$key=$value"
}

# compose.sh must read .env itself: Docker Compose loads .env for interpolation,
# but the shell needs DOCKER_SHARED_NETWORK to decide whether to include the overlay.
load_env_var .env DOCKER_SHARED_NETWORK

compose_args=(-f docker-compose.yml)

if [[ -n "${DOCKER_SHARED_NETWORK:-}" ]]; then
  compose_args+=(-f docker-compose.shared-network.yml)
fi

exec docker compose "${compose_args[@]}" "$@"
