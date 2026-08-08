import { test, expect } from '@grafana/plugin-e2e';

test('trace mode shows hint when no trace ID is set', async ({ gotoPanelEditPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  // Panel 2 is the trace detail panel; $traceId defaults to empty → shows hint
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(panelEditPage.panel.locator).toContainText('Enter a Trace ID in panel options.');
});

test('DataProxy can reach Jaeger — /api/v3/services returns data', async ({
  readProvisionedDataSource,
  request,
}) => {
  // Frontend-only plugins have no Go backend so the /health endpoint returns
  // "plugin unavailable". Verify DataProxy connectivity by proxying a real API call.
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  // A 200 response proves the DataProxy can reach Jaeger — no need to assert
  // non-empty services since HotROD may not have sent traces yet at test time.
  const resp = await request.get(`/api/datasources/proxy/uid/${datasource.uid}/api/v3/services`);
  await expect(resp).toBeOK();
  const body = await resp.json();
  expect(Array.isArray(body.services)).toBe(true);
});

test('datasource QueryEditor service dropdown is populated from live Jaeger API', async ({
  readProvisionedDataSource,
  explorePage,
  selectors,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await explorePage.goto();
  await explorePage.datasource.set(datasource.name);
  // Wait for the QueryEditor to finish rendering after datasource selection
  const serviceSelect = explorePage.ctx.page.getByRole('combobox', { name: 'Service' });
  await serviceSelect.waitFor({ state: 'visible', timeout: 10000 });
  await serviceSelect.click();
  // Assert a known HotROD service appears — verifies the live Jaeger API was actually queried
  await expect(explorePage.getByGrafanaSelector(selectors.components.Select.option).filter({ hasText: 'frontend' })).toBeVisible();
});

test('search query returns trace-summaries result table with expected columns', async ({
  readProvisionedDataSource,
  explorePage,
  selectors,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  // Widen the viewport so the virtualized grid renders all columns
  await explorePage.ctx.page.setViewportSize({ width: 1600, height: 900 });
  // Navigate with explicit clean state to avoid stale URL params (e.g. tags from previous tests)
  await explorePage.ctx.page.goto(
    `/explore?schemaVersion=1&panes={"left":{"datasource":"${datasource.uid}","queries":[{"refId":"A","queryType":"search"}],"range":{"from":"now-6h","to":"now"}}}&orgId=1`
  );

  // Select the 'frontend' service and run the query
  const serviceSelect = explorePage.ctx.page.getByRole('combobox', { name: 'Service' });
  await serviceSelect.waitFor({ state: 'visible', timeout: 10000 });
  await serviceSelect.click();
  await explorePage.getByGrafanaSelector(selectors.components.Select.option).filter({ hasText: 'frontend' }).click();
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
