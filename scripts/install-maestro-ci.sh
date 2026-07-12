#!/usr/bin/env bash
set -euo pipefail

MAESTRO_VERSION="2.4.0"
MAESTRO_SHA256="aea22ce67ab6718997ec990c58652ede0c2be8f10ac4799039ca3dce3390d634"
MAESTRO_URL="https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip"
INSTALL_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/maestro-${MAESTRO_VERSION}"
ARCHIVE="${INSTALL_ROOT}/maestro.zip"

rm -rf "${INSTALL_ROOT}"
mkdir -p "${INSTALL_ROOT}"
curl -fsSL --retry 3 --retry-all-errors "${MAESTRO_URL}" -o "${ARCHIVE}"

if command -v shasum >/dev/null 2>&1; then
  printf '%s  %s\n' "${MAESTRO_SHA256}" "${ARCHIVE}" | shasum -a 256 -c -
else
  printf '%s  %s\n' "${MAESTRO_SHA256}" "${ARCHIVE}" | sha256sum -c -
fi

unzip -q "${ARCHIVE}" -d "${INSTALL_ROOT}"
MAESTRO_BIN_DIR="${INSTALL_ROOT}/maestro/bin"
"${MAESTRO_BIN_DIR}/maestro" --version

if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "${MAESTRO_BIN_DIR}" >> "${GITHUB_PATH}"
else
  printf 'Add %s to PATH.\n' "${MAESTRO_BIN_DIR}"
fi
