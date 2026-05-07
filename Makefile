.PHONY: build dev test lint server e2e panel-% datasource-%

build:
	npm run build

test:
	npm run test:ci

lint:
	npm run lint

panel-%:
	npm run $* --workspace=packages/panel

datasource-%:
	npm run $* --workspace=packages/datasource
