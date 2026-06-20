#!/usr/bin/env bash
set -euo pipefail

# Cursor / local shell environments sometimes inject Node's experimental
# web-storage flags through NODE_OPTIONS. Vitest runs in jsdom and provides its
# own storage APIs, so inheriting those flags just creates noisy warnings and
# non-reproducible behavior.
sanitize_node_options() {
  python3 - "${NODE_OPTIONS-}" <<'PY'
import shlex
import sys

if len(sys.argv) < 2 or not sys.argv[1]:
    print("")
    raise SystemExit(0)

tokens = shlex.split(sys.argv[1])
sanitized = []
skip_next = False

for index, token in enumerate(tokens):
    if skip_next:
        skip_next = False
        continue

    if token in (
        "--experimental-webstorage",
        "--webstorage",
        "--no-webstorage",
        "--no-experimental-webstorage",
        "--localstorage-file",
        "--sessionstorage-file",
    ):
        if token in ("--localstorage-file", "--sessionstorage-file") and index + 1 < len(tokens):
            skip_next = True
        continue

    if token.startswith("--localstorage-file=") or token.startswith("--sessionstorage-file="):
        continue

    sanitized.append(token)

print(" ".join(shlex.quote(token) for token in sanitized))
PY
}

if [[ -n "${NODE_OPTIONS-}" ]]; then
  SANITIZED_NODE_OPTIONS="$(sanitize_node_options)"
  if [[ -n "$SANITIZED_NODE_OPTIONS" ]]; then
    export NODE_OPTIONS="$SANITIZED_NODE_OPTIONS"
  else
    unset NODE_OPTIONS
  fi
fi

unset npm_config_node_options
unset NPM_CONFIG_NODE_OPTIONS
unset npm_config_localstorage_file
unset npm_config_sessionstorage_file
unset npm_config_experimental_webstorage
unset npm_config_webstorage
unset npm_package_config_localstorage_file
unset npm_package_config_sessionstorage_file
unset npm_package_config_experimental_webstorage
unset npm_package_config_webstorage

detect_webstorage_disable_flag() {
  local flag
  for flag in --no-webstorage --no-experimental-webstorage; do
    if node "$flag" -e "" >/dev/null 2>&1; then
      printf '%s\n' "$flag"
      return 0
    fi
  done
}

NODE_WEBSTORAGE_ARGS=()
if WEBSTORAGE_DISABLE_FLAG="$(detect_webstorage_disable_flag)"; then
  NODE_WEBSTORAGE_ARGS=("$WEBSTORAGE_DISABLE_FLAG")
fi

run_vitest() {
  exec node \
    "${NODE_WEBSTORAGE_ARGS[@]}" \
    ./node_modules/vitest/vitest.mjs \
    "$@"
}

HAS_POOL_FLAG=0
if (($# > 0)); then
  for arg in "$@"; do
    if [[ "$arg" == --pool* ]]; then
      HAS_POOL_FLAG=1
      break
    fi
  done
fi

if [[ "$HAS_POOL_FLAG" -eq 1 ]]; then
  if (($# > 0)); then
    run_vitest "$@"
  fi

  run_vitest
fi

if (($# > 0)); then
  run_vitest --pool=threads "$@"
fi

run_vitest --pool=threads
