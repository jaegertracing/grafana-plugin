.PHONY: build dev test lint server e2e

build:
	npm run build

dev:
	npm run dev

test:
	npm run test:ci

lint:
	npm run lint

server:
	npm run server

e2e:
	npm run e2e
