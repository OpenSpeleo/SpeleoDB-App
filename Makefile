# ──────────────────────────────────────────────────────────────
#  SpeleoDB – Makefile
#  Run `make help` to see available targets.
# ──────────────────────────────────────────────────────────────

# ── Configuration ─────────────────────────────────────────────
APP_NAME        := SpeleoDB
SCHEME          := App
XCODEPROJ       := ios/App/App.xcodeproj
WORKSPACE       := ios/App/App.xcworkspace
BUNDLE_ID       := io.ionic.starter

# Default simulator (override with: make ios-sim SIMULATOR="iPhone 17 Pro Max")
SIMULATOR       ?= iPhone 17 Pro
IOS_RUNTIME     ?= iOS-26-2

# Derived
DEVICE_UDID     = $(shell xcrun simctl list devices available | grep "$(SIMULATOR)" | head -1 | sed -E 's/.*\(([A-F0-9-]+)\).*/\1/')
BUILD_DIR       := build

.PHONY: help install clean dev build lint test test.e2e \
        sync ios-open ios-build ios-sim ios-sim-run ios-sim-boot ios-sim-shutdown \
        ios-device ios-log cap-doctor

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
	npm install

# ── Web ───────────────────────────────────────────────────────
dev: ## Start Vite dev server with live reload
	npx ionic serve

build: ## Build the web app for production
	npx ionic build --prod

clean: ## Remove build artifacts
	rm -rf dist $(BUILD_DIR) node_modules/.vite
	@echo "Cleaned dist/, $(BUILD_DIR)/, and Vite cache."

lint: ## Run ESLint
	npm run lint

# ── Tests ─────────────────────────────────────────────────────
test: ## Run unit tests (Vitest)
	npm run test.unit

test.e2e: ## Run end-to-end tests (Cypress)
	npm run test.e2e

# ── Capacitor ─────────────────────────────────────────────────
sync: build ## Build web + sync to native platforms
	npx cap sync ios

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
	@echo "Booting simulator: $(SIMULATOR)…"
	@if [ -z "$(DEVICE_UDID)" ]; then \
		echo "Error: Simulator '$(SIMULATOR)' not found. Available:"; \
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
	npx ionic cap run ios --livereload --external

ios-log: ## Stream logs from the booted simulator
	@if [ -z "$(DEVICE_UDID)" ]; then \
		echo "Error: Simulator '$(SIMULATOR)' not found."; \
		exit 1; \
	fi
	xcrun simctl spawn $(DEVICE_UDID) log stream --level debug --predicate 'processImagePath CONTAINS "$(SCHEME)"'

generate-assets:
	npm install @capacitor/assets --save-dev
	npx capacitor-assets generate --iconBackgroundColor "#0f182a"
