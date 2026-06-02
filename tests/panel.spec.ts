import { test, expect } from '@grafana/plugin-e2e';

test('trace mode shows hint when no trace ID is set', async ({ gotoPanelEditPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  // Panel 2 is the trace detail panel; $traceId defaults to empty → shows hint
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(panelEditPage.panel.locator).toContainText('Enter a Trace ID in panel options.');
});

test('DataProxy can reach Jaeger — /api/services returns data', async ({
  readProvisionedDataSource,
  request,
}) => {
  // Frontend-only plugins have no Go backend so the /health endpoint returns
  // "plugin unavailable". Verify DataProxy connectivity by proxying a real API call.
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  // A 200 response proves the DataProxy can reach Jaeger — no need to assert
  // non-empty services since HotROD may not have sent traces yet at test time.
  const resp = await request.get(`/api/datasources/proxy/uid/${datasource.uid}/api/services`);
  await expect(resp).toBeOK();
  const body = await resp.json();
  expect(Array.isArray(body.data)).toBe(true);
});

test('datasource QueryEditor service dropdown is populated from live Jaeger API', async ({
  readProvisionedDataSource,
  explorePage,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await explorePage.goto();
  await explorePage.datasource.set(datasource.name);
  // Wait for the QueryEditor to finish rendering after datasource selection
  const serviceSelect = explorePage.ctx.page.getByRole('combobox', { name: 'Service' });
  await serviceSelect.waitFor({ state: 'visible', timeout: 10000 });
  await serviceSelect.click();
  // Assert a known HotROD service appears — verifies the live Jaeger API was actually queried
  await expect(explorePage.ctx.page.getByRole('option', { name: 'frontend' })).toBeVisible();
});

test('search query returns trace-summaries result table with expected columns', async ({
  readProvisionedDataSource,
  explorePage,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await explorePage.goto();
  await explorePage.datasource.set(datasource.name);

  // Widen the viewport so the virtualized grid renders all columns
  await explorePage.ctx.page.setViewportSize({ width: 1600, height: 900 });

  // Select the 'frontend' service and run the query
  const serviceSelect = explorePage.ctx.page.getByRole('combobox', { name: 'Service' });
  await serviceSelect.waitFor({ state: 'visible', timeout: 10000 });
  await serviceSelect.click();
  await explorePage.ctx.page.getByRole('option', { name: 'frontend' }).click();
  await explorePage.ctx.page.getByRole('button', { name: /run query/i }).click();

  // The results grid should contain the columns returned by /api/v3/trace-summaries
  // Grafana's table component uses role="grid" (not role="table")
  const grid = explorePage.ctx.page.getByRole('grid');
  await expect(grid).toBeVisible({ timeout: 10000 });
  const headers = grid.getByRole('columnheader');
  await expect(headers.filter({ hasText: 'traceID' })).toBeVisible();
  await expect(headers.filter({ hasText: 'traceName' })).toBeVisible();
  await expect(headers.filter({ hasText: 'startTime' })).toBeVisible();
  await expect(headers.filter({ hasText: 'duration' })).toBeVisible();
  await expect(headers.filter({ hasText: 'spanCount' })).toBeVisible();
  await expect(headers.filter({ hasText: 'errorCount' })).toBeVisible();
  await expect(headers.filter({ hasText: 'services' })).toBeVisible();

  // At least one data row should be present
  await expect(grid.getByRole('row').nth(1)).toBeVisible();
});
