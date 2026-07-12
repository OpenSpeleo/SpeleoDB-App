#!/usr/bin/env bash
set -euo pipefail

PLATFORM="${1:-}"
if [[ "${PLATFORM}" != "android" && "${PLATFORM}" != "ios" ]]; then
  echo 'Usage: run-release-e2e.sh <android|ios>' >&2
  exit 2
fi

scripts/verify-release-e2e-environment.sh

REPORT_DIR="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/speleodb-release-e2e.XXXXXX")"
ROUTE_FILE="${REPORT_DIR}/blocked-routes"
INSTANCE_HOST="$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "${SPELEODB_E2E_INSTANCE_URL}")"
NETWORK_STATE="online"

restore_network() {
  if [[ "${PLATFORM}" == "android" ]]; then
    adb shell settings put global airplane_mode_on 0 >/dev/null 2>&1 || true
    adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false >/dev/null 2>&1 || true
    adb shell svc wifi enable >/dev/null 2>&1 || true
    adb shell svc data enable >/dev/null 2>&1 || true
  elif [[ -f "${ROUTE_FILE}" ]]; then
    while IFS='|' read -r family address; do
      if [[ "${family}" == "4" ]]; then
        sudo route -n delete -host "${address}" 127.0.0.1 >/dev/null 2>&1 || true
      else
        sudo route -n delete -inet6 -host "${address}" ::1 >/dev/null 2>&1 || true
      fi
    done < "${ROUTE_FILE}"
    : > "${ROUTE_FILE}"
  fi
  NETWORK_STATE="online"
}

wait_for_android_network() {
  local expected="$1"
  local attempt
  for attempt in {1..30}; do
    if adb shell dumpsys connectivity | grep -q 'VALIDATED'; then
      [[ "${expected}" == "online" ]] && return
    else
      [[ "${expected}" == "offline" ]] && return
    fi
    sleep 1
  done
  echo "Android connectivity did not become ${expected}" >&2
  exit 1
}

wait_for_ios_online() {
  local attempt
  for attempt in {1..30}; do
    if curl --noproxy '*' -sS --connect-timeout 2 -o /dev/null "${SPELEODB_E2E_INSTANCE_URL}"; then
      return
    fi
    sleep 1
  done
  echo 'iOS simulator host connectivity did not recover' >&2
  exit 1
}

cleanup() {
  restore_network
  rm -rf "${REPORT_DIR}"
}
trap cleanup EXIT

set_network() {
  local requested="$1"
  if [[ "${requested}" == "${NETWORK_STATE}" ]]; then
    return
  fi

  if [[ "${PLATFORM}" == "android" ]]; then
    if [[ "${requested}" == "offline" ]]; then
      adb shell svc wifi disable
      adb shell svc data disable
      adb shell settings put global airplane_mode_on 1
      adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true >/dev/null
      wait_for_android_network offline
    else
      restore_network
      wait_for_android_network online
    fi
  elif [[ "${requested}" == "offline" ]]; then
    : > "${ROUTE_FILE}"
    while read -r address; do
      [[ -z "${address}" ]] && continue
      sudo route -n add -host "${address}" 127.0.0.1
      printf '4|%s\n' "${address}" >> "${ROUTE_FILE}"
    done < <(dig +short A "${INSTANCE_HOST}" | awk '/^[0-9.]+$/')
    while read -r address; do
      [[ -z "${address}" ]] && continue
      sudo route -n add -inet6 -host "${address}" ::1
      printf '6|%s\n' "${address}" >> "${ROUTE_FILE}"
    done < <(dig +short AAAA "${INSTANCE_HOST}" | awk '/^[0-9A-Fa-f:]+$/')
    if [[ ! -s "${ROUTE_FILE}" ]]; then
      echo "Could not resolve ${INSTANCE_HOST}; refusing to claim an offline test" >&2
      exit 1
    fi
    if curl --noproxy '*' -sS --connect-timeout 2 -o /dev/null "${SPELEODB_E2E_INSTANCE_URL}"; then
      echo 'iOS route isolation did not make the configured instance unreachable' >&2
      exit 1
    fi
  else
    restore_network
    wait_for_ios_online
  fi
  NETWORK_STATE="${requested}"
}

run_flow() {
  local flow="$1"
  local landmark_name="$2"
  local report_name
  report_name="$(basename "${flow}" .yaml)"
  maestro test \
    --format JUNIT \
    --output "${REPORT_DIR}/${report_name}.xml" \
    --test-output-dir "${REPORT_DIR}/artifacts" \
    --debug-output "${REPORT_DIR}/debug" \
    -e "SPELEODB_E2E_OAUTH_TOKEN=${SPELEODB_E2E_OAUTH_TOKEN}" \
    -e "SPELEODB_E2E_INSTANCE_URL=${SPELEODB_E2E_INSTANCE_URL}" \
    -e "SPELEODB_E2E_PROJECT_NAME=${SPELEODB_E2E_PROJECT_NAME}" \
    -e "SPELEODB_E2E_LANDMARK_NAME=${landmark_name}" \
    "${flow}"
}

RUN_SUFFIX="${GITHUB_RUN_ID:-local}-$(date +%s)"
REPLAY_NAME="RR-E2E-${PLATFORM}-${RUN_SUFFIX}-replay"
LOGOUT_NAME="RR-E2E-${PLATFORM}-${RUN_SUFFIX}-logout"

run_flow .maestro/flows/01-bootstrap.yaml "${REPLAY_NAME}"
set_network offline
run_flow .maestro/flows/02-create-pending.yaml "${REPLAY_NAME}"
set_network online
run_flow .maestro/flows/03-replay-cleanup.yaml "${REPLAY_NAME}"
set_network offline
run_flow .maestro/flows/02-create-pending.yaml "${LOGOUT_NAME}"
set_network online
run_flow .maestro/flows/04-logout-purge.yaml "${LOGOUT_NAME}"
