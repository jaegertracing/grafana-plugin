/**
 * Playwright e2e tests for the reverse-proxy deployment scenario.
 *
 * Runs against the Grafana instance in examples/reverse-proxy/ (port 18082),
 * which has two Jaeger datasources pointing at httpd reverse proxies:
 *   - jaeger-option1: transparent proxy + --query.base-path
 *   - jaeger-option2: prefix stripping (base path auto-detected by UI since Jaeger 2.18.0)
 *
 * The Grafana in this stack has anonymous Admin auth enabled, so no login needed.
 * Datasource UIDs are stable (defined in examples/reverse-proxy/provisioning/datasources/datasources.yml).
 *
 * Run via: make test-reverse-proxy  (starts the stack, runs these tests, tears down)
 */

import { test, expect } from '@playwright/test';

// Datasource UIDs as provisioned in examples/reverse-proxy/provisioning/datasources/datasources.yml
const DATASOURCES = [
  {
    label: 'Option 1 (transparent proxy)',
    uid: 'jaeger-option1',
    name: 'Jaeger-Option1',
    expectedPublicURL: 'http://localhost:18080/jaeger/ui',
  },
  {
    label: 'Option 2 (prefix stripping)',
    uid: 'jaeger-option2',
    name: 'Jaeger-Option2',
    expectedPublicURL: 'http://localhost:18081/jaeger/ui',
  },
];

for (const ds of DATASOURCES) {
  test(`${ds.label}: /api/services returns data via public URL`, async ({ request }) => {
    const resp = await request.get(`${ds.expectedPublicURL}/api/services`);
    await expect(resp).toBeOK();
    const body = await resp.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test(`${ds.label}: jaegerPublicURL is set to proxy address`, async ({ request }) => {
    const resp = await request.get(`/api/datasources/uid/${ds.uid}`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.jsonData.jaegerPublicURL).toBe(ds.expectedPublicURL);
  });

  test(`${ds.label}: panel config editor shows jaegerPublicURL pointing at proxy`, async ({ page }) => {
    // Navigate to the datasource config page and verify the Jaeger UI URL field
    // shows the proxy address. This confirms the panel would render the iframe
    // pointing at the correct proxy-prefixed URL.
    await page.goto(`/connections/datasources/edit/${ds.uid}`);
    const urlInput = page.getByTestId('jaeger-public-url-input');
    await expect(urlInput).toBeVisible({ timeout: 10000 });
    await expect(urlInput).toHaveValue(ds.expectedPublicURL);
  });
}
