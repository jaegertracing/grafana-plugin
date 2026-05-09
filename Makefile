.PHONY: build build-backend vet-backend test lint server test-reverse-proxy panel-% datasource-%

build: build-backend
	npm run build

build-backend:
	(cd packages/datasource && go tool mage build:linuxARM64 build:linux)

vet-backend:
	(cd packages/datasource && go vet ./pkg/...)

test:
	npm run test:ci

lint:
	npm run lint

server:
	docker compose up --build

test-reverse-proxy:
	docker compose -f examples/reverse-proxy/docker-compose.yaml up -d
	examples/reverse-proxy/test.sh; \
	  status=$$?; \
	  docker compose -f examples/reverse-proxy/docker-compose.yaml down; \
	  exit $$status

panel-%:
	npm run $* --workspace=packages/panel

datasource-%:
	npm run $* --workspace=packages/datasource
