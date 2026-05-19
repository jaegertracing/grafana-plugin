# Releasing

## Prerequisites

- Write access to this repository
- `npm` and `jq` available locally

## Process

1. **Bump the version** in both plugin `package.json` files:

   ```bash
   make bump-version VERSION=0.2.0
   ```

2. **Commit and tag:**

   ```bash
   git commit -s -m "chore: bump version to 0.2.0"
   git tag v0.2.0
   git push --follow-tags
   ```

3. **Wait for CI.** The `Release` workflow triggers on the tag, then:
   - Builds `packages/panel` and `packages/datasource`
   - Validates each with `plugin-validator-cli`
   - Creates a **draft** GitHub Release with three assets:
     - `jaegertracing-jaeger-panel-<version>.zip`
     - `jaegertracing-jaeger-datasource-<version>.zip`
     - `checksums.txt` (SHA256 of both zips)

4. **Review and publish** the draft release at
   `https://github.com/jaegertracing/grafana-plugin/releases`. Edit the
   auto-generated release notes if needed, then click **Publish release**.

## Installing a release

Download the zip(s) and `checksums.txt` from the release page, then verify
before installing:

```bash
sha256sum -c checksums.txt
```

To install on a self-hosted Grafana, unzip into the Grafana plugins directory
and add to `grafana.ini`:

```ini
[plugins]
allow_loading_unsigned_plugins = jaegertracing-jaeger-panel,jaegertracing-jaeger-datasource
```

## Signing (optional)

Signed plugins load without the `allow_loading_unsigned_plugins` override.
To enable signing, store a Grafana Access Policy Token (with `plugins:write`
scope) as the `GRAFANA_ACCESS_POLICY_TOKEN` repository secret and uncomment
the `policy_token` lines in `.github/workflows/release.yml`.
