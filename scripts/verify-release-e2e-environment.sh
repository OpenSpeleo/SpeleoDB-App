#!/usr/bin/env bash
set -euo pipefail

missing=()
for name in \
  SPELEODB_E2E_OAUTH_TOKEN \
  SPELEODB_E2E_INSTANCE_URL \
  SPELEODB_E2E_PROJECT_NAME
do
  if [[ -z "${!name:-}" ]]; then
    missing+=("${name}")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing release E2E configuration: %s\n' "${missing[*]}" >&2
  exit 1
fi

node -e '
  const value = new URL(process.env.SPELEODB_E2E_INSTANCE_URL);
  if (value.protocol !== "https:" || value.username || value.password || value.pathname !== "/") {
    throw new Error("SPELEODB_E2E_INSTANCE_URL must be a credential-free HTTPS origin");
  }
'
