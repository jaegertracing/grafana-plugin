## Project knowledge

This repository contains a **Grafana plugin**. You must Read @./.config/AGENTS/instructions.md before doing changes.

## Git commits

Always sign off commits with `-s` (`--signoff`).

## Before committing

After making code changes, run integration tests before committing:

```bash
make test-reverse-proxy
```

This builds the plugins, starts the reverse-proxy stack, runs 12 curl/jq assertions and 6 Playwright tests, then tears down. All must pass before committing.
