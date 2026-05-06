# Jaeger Panel Plugin for Grafana

A Grafana panel plugin that embeds [Jaeger](https://www.jaegertracing.io/) trace visualizations inside Grafana dashboards using Jaeger's built-in `uiEmbed=v0` mode.

## Overview

The plugin renders an iframe pointing at a Jaeger Query service. Three modes are supported:

| Mode | Description |
|------|-------------|
| **Single trace** | Renders the full trace timeline for a given trace ID |
| **Trace diff** | Side-by-side comparison of two traces |
| **Search** | Embeds Jaeger's search page for querying traces by service, operation, and tags |

## Prerequisites

- A running Jaeger Query service reachable from the user's browser (the iframe loads Jaeger UI directly).
- Grafana 12.3.0 or later.

## Panel options

| Option | Description |
|--------|-------------|
| **Mode** | `Single trace`, `Trace diff`, or `Search` |
| **Jaeger UI base URL** | URL of the Jaeger Query service, e.g. `http://jaeger:16686` |
| **Trace ID** | Trace ID to display. Supports dashboard variables: `${traceId}` |
| **Trace ID (B)** | Second trace ID for diff mode. Supports dashboard variables |
| **Service** | Pre-selects a service in search mode. Supports dashboard variables |
| **Hide minimap** | Hides the span minimap (trace/diff modes) |
| **Hide trace summary** | Hides the summary row above the timeline (trace/diff modes) |
| **Collapse trace header** | Starts the trace header collapsed (trace/diff modes) |

## Dashboard variables

Use Grafana dashboard variables to drive the trace ID from a URL parameter or from a data link in another panel:

1. Add a **Text box** variable named `traceId` to your dashboard.
2. Set the panel's **Trace ID** option to `${traceId}`.
3. The panel updates whenever the variable changes.

## Development

### Requirements

- Node.js >= 22
- Docker (for running the local Grafana + Jaeger stack)

### Build and run

```bash
# Build the plugin
make build

# Start Grafana, Jaeger all-in-one, and HotROD demo app
make server

# Watch mode for development
make dev
```

Services started by `make server`:

| Service | URL |
|---------|-----|
| Grafana | http://localhost:3000 (admin / admin) |
| Jaeger UI | http://localhost:16686 |
| HotROD demo | http://localhost:8080 |

### Run e2e tests

```bash
# Terminal 1: start the stack (builds the plugin automatically)
make server

# Terminal 2: run Playwright tests
make e2e
```

### Run unit tests

```bash
make test
```

### Lint

```bash
make lint
```

## Architecture

See [docs/adr/0001-jaeger-ui-in-grafana.md](docs/adr/0001-jaeger-ui-in-grafana.md) for the full architecture decision record.

## License

Apache-2.0
