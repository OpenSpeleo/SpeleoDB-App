# ──────────────────────────────────────────────────────────────
#  SpeleoDB – Makefile
#  Run `make help` to see available targets.
# ──────────────────────────────────────────────────────────────

# ── Configuration ─────────────────────────────────────────────
APP_NAME        := SpeleoDB
SCHEME          := App
XCODEPROJ       := ios/App/App.xcodeproj
WORKSPACE       := ios/App/App.xcworkspace
BUNDLE_ID       := org.speleodb.app

# Optional preferred simulator. When omitted, use the first available iPhone.
SIMULATOR       ?=

# Derived
DEVICE_UDID     = $(shell node scripts/resolve-ios-simulator.mjs "$(SIMULATOR)" 2>/dev/null)
SIMULATOR_LABEL = $(if $(SIMULATOR),$(SIMULATOR),auto-selected iPhone)
BUILD_DIR       := build

.PHONY: help install clean dev build quality lint typecheck test test-ci ci \
        pre-commit \
        sync ios-open ios-build ios-release ios-sim ios-sim-run ios-sim-boot \
        ios-sim-shutdown ios-device ios-live ios-log cap-doctor \
        dependencies

# ── Help ──────────────────────────────────────────────────────
help: ## Show this help
	@echo ""
	@echo "  $(APP_NAME) – Available targets"
	@echo "  ──────────────────────────────────────────"
	@grep -E '^[a-zA-Z_.-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ── Dependencies ──────────────────────────────────────────────
install: ## Install npm dependencies
	npm ci

# ── Web ───────────────────────────────────────────────────────
dev: ## Start Vite dev server with live reload
	npm run dev

build: ## Build the web app for production
	npm run build

clean: ## Remove build artifacts
	rm -rf dist $(BUILD_DIR) node_modules/.vite
	@echo "Cleaned dist/, $(BUILD_DIR)/, and Vite cache."

lint: ## Run ESLint
	npm run lint

quality: ## Verify every tracked file has a quality classification
	npm run quality:inventory

typecheck: ## Run TypeScript type checking
	npm run typecheck

# ── Tests ─────────────────────────────────────────────────────
test: ## Run unit tests (Vitest)
	npm run test.unit

test-ci: ## Run unit tests (Vitest, one-shot)
	npm run test:ci

# ── CI ────────────────────────────────────────────────────────
ci: quality lint typecheck test-ci build ## Run the full web CI pipeline locally

# ── Git hooks (prek) ──────────────────────────────────────────
pre-commit: ## Run all pre-commit hooks against the entire repo
	npx prek run --all-files

# ── Capacitor ─────────────────────────────────────────────────
sync: build ## Build web + sync to both native platforms
	npx cap sync

cap-doctor: ## Run Capacitor doctor diagnostics
	npx cap doctor

# ── iOS (no Xcode GUI needed) ────────────────────────────────
ios-open: ## Open the project in Xcode
	npx cap open ios

ios-build: sync ## Build iOS app via xcodebuild (Debug)
	xcodebuild \
		-project $(XCODEPROJ) \
		-scheme $(SCHEME) \
		-configuration Debug \
		-destination 'generic/platform=iOS Simulator' \
		-derivedDataPath $(BUILD_DIR) \
		-allowProvisioningUpdates \
		CODE_SIGNING_ALLOWED=NO \
		build | xcbeautify 2>/dev/null || \
	xcodebuild \
		-project $(XCODEPROJ) \
		-scheme $(SCHEME) \
		-configuration Debug \
		-destination 'generic/platform=iOS Simulator' \
		-derivedDataPath $(BUILD_DIR) \
		-allowProvisioningUpdates \
		CODE_SIGNING_ALLOWED=NO \
		build

ios-release: sync ## Build iOS app via xcodebuild (Release)
	xcodebuild \
		-project $(XCODEPROJ) \
		-scheme $(SCHEME) \
		-configuration Release \
		-destination 'generic/platform=iOS Simulator' \
		-derivedDataPath $(BUILD_DIR) \
		-allowProvisioningUpdates \
		CODE_SIGNING_ALLOWED=NO \
		build | xcbeautify 2>/dev/null || \
	xcodebuild \
		-project $(XCODEPROJ) \
		-scheme $(SCHEME) \
		-configuration Release \
		-destination 'generic/platform=iOS Simulator' \
		-derivedDataPath $(BUILD_DIR) \
		-allowProvisioningUpdates \
		CODE_SIGNING_ALLOWED=NO \
		build

ios-sim-boot: ## Boot the iOS simulator
	@echo "Booting simulator: $(SIMULATOR_LABEL)…"
	@if [ -z "$(DEVICE_UDID)" ]; then \
		echo "Error: No matching iPhone simulator found. Available:"; \
		xcrun simctl list devices available | grep iPhone; \
		exit 1; \
	fi
	xcrun simctl boot $(DEVICE_UDID) 2>/dev/null || true
	open -a Simulator

ios-sim-shutdown: ## Shutdown all running simulators
	xcrun simctl shutdown all

ios-sim: ios-build ios-sim-boot ## Build + install + launch on simulator
	@echo "Installing on simulator $(DEVICE_UDID)…"
	@APP_PATH=$$(find $(BUILD_DIR) -name "$(SCHEME).app" -path "*/Debug-iphonesimulator/*" | head -1); \
	if [ -z "$$APP_PATH" ]; then \
		echo "Error: Could not find $(SCHEME).app in $(BUILD_DIR). Build may have failed."; \
		exit 1; \
	fi; \
	echo "Found app: $$APP_PATH"; \
	xcrun simctl install $(DEVICE_UDID) "$$APP_PATH"; \
	xcrun simctl launch $(DEVICE_UDID) $(BUNDLE_ID)

ios-sim-run: ios-sim-boot ## Install + launch on simulator (skip build, uses last build)
	@echo "Installing on simulator $(DEVICE_UDID)…"
	@APP_PATH=$$(find $(BUILD_DIR) -name "$(SCHEME).app" -path "*/Debug-iphonesimulator/*" | head -1); \
	if [ -z "$$APP_PATH" ]; then \
		echo "Error: No previous build found. Run 'make ios-sim' first."; \
		exit 1; \
	fi; \
	xcrun simctl install $(DEVICE_UDID) "$$APP_PATH"; \
	xcrun simctl launch $(DEVICE_UDID) $(BUNDLE_ID)

ios-device: sync ## Build + run on a connected physical device
	xcodebuild \
		-project $(XCODEPROJ) \
		-scheme $(SCHEME) \
		-configuration Debug \
		-destination 'platform=iOS,name=My Device' \
		-derivedDataPath $(BUILD_DIR) \
		-allowProvisioningUpdates \
		build | xcbeautify 2>/dev/null || \
	xcodebuild \
		-project $(XCODEPROJ) \
		-scheme $(SCHEME) \
		-configuration Debug \
		-destination 'platform=iOS,name=My Device' \
		-derivedDataPath $(BUILD_DIR) \
		-allowProvisioningUpdates \
		build

ios-live: ## Live-reload on iOS simulator (Ionic + Capacitor)
	@set -a; \
	if [ -f .env ]; then . ./.env; fi; \
	set +a; \
	VITE_SENTRY_DSN="$${VITE_SENTRY_DSN:-$${SENTRY_DSN_IOS}}" npx ionic cap run ios --livereload --external

ios-log: ## Stream logs from the booted simulator
	@if [ -z "$(DEVICE_UDID)" ]; then \
		echo "Error: Simulator '$(SIMULATOR)' not found."; \
		exit 1; \
	fi
	xcrun simctl spawn $(DEVICE_UDID) log stream --level debug --predicate 'processImagePath CONTAINS "$(SCHEME)"'

dependencies: ## Report dependency drift without modifying manifests or the lockfile
	npm outdated

update:
	npx --yes npm-check-updates -u --peer
	npm install
