.PHONY: install format format-check lint typecheck test build check dev dev-worker

install:
	npm install

format:
	npm run format

format-check:
	npm run format:check

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm run test

build:
	npm run build

check:
	@set -e; total=5; passed=0; \
	npm run format:check; passed=$$((passed + 1)); echo "Progress: $$passed/$$total checks passed"; \
	npm run lint; passed=$$((passed + 1)); echo "Progress: $$passed/$$total checks passed"; \
	npm run typecheck; passed=$$((passed + 1)); echo "Progress: $$passed/$$total checks passed"; \
	npm run test; passed=$$((passed + 1)); echo "Progress: $$passed/$$total checks passed"; \
	npm run build; passed=$$((passed + 1)); echo "Progress: $$passed/$$total checks passed"

dev:
	npm run dev

dev-worker:
	npm run dev:worker
