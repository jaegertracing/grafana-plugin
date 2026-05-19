.PHONY: build test lint server test-reverse-proxy bump-version panel-% datasource-%

build:
	npm run build

test:
	npm run test:ci

lint:
	npm run lint

server:
	docker compose up --build

# Starts the reverse-proxy example stack, runs curl/jq API tests and Playwright e2e
# tests against the Grafana instance in that stack (port 18082), then tears down.
test-reverse-proxy:
	docker compose -f examples/reverse-proxy/docker-compose.yaml up -d
	examples/reverse-proxy/test.sh && \
	  GRAFANA_URL=http://localhost:18082 npx playwright test \
	    --config playwright/reverse-proxy.config.ts; \
	  status=$$?; \
	  docker compose -f examples/reverse-proxy/docker-compose.yaml down; \
	  exit $$status

# Usage: make bump-version VERSION=0.2.0
# Updates package.json in both plugins, then: git commit -s -m "chore: bump version to $(VERSION)" && git tag v$(VERSION) && git push --follow-tags
bump-version:
	npm version --no-git-tag-version $(VERSION) --workspace packages/panel --workspace packages/datasource

panel-%:
	npm run $* --workspace=packages/panel

datasource-%:
	npm run $* --workspace=packages/datasource
