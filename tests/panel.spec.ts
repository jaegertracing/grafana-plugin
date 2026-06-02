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
  const resp = await request.get(`/api/datasources/proxy/uid/${datasource.uid}/api/services`);
  await expect(resp).toBeOK();
  const body = await resp.json();
  expect(Array.isArray(body.data)).toBe(true);
  expect(body.data.length).toBeGreaterThan(0);
});

test('datasource QueryEditor service dropdown is populated from live Jaeger API', async ({
  readProvisionedDataSource,
  explorePage,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await explorePage.goto();
  await explorePage.datasource.set(datasource.name);
  // The QueryEditor renders a Service select identified by its placeholder text
  const serviceSelect = explorePage.ctx.page.locator('input[aria-describedby$="-placeholder"]').first();
  await serviceSelect.click();
  // Assert a known HotROD service appears — verifies the live Jaeger API was actually queried
  await expect(explorePage.ctx.page.getByRole('option', { name: 'frontend' })).toBeVisible();
});

test.skip('search query returns trace-summaries result table with expected columns', async ({
  readProvisionedDataSource,
  explorePage,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await explorePage.goto();
  await explorePage.datasource.set(datasource.name);

  // Select the 'frontend' service and run the query
  const serviceSelect = explorePage.ctx.page.locator('input[aria-describedby$="-placeholder"]').first();
  await serviceSelect.click();
  await explorePage.ctx.page.getByRole('option', { name: 'frontend' }).click();
  await explorePage.ctx.page.getByRole('button', { name: /run query/i }).click();

  // The results table should contain the columns returned by /api/v3/trace-summaries
  const table = explorePage.ctx.page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 10000 });
  const header = table.getByRole('row').first();
  await expect(header).toContainText('traceID');
  await expect(header).toContainText('traceName');
  await expect(header).toContainText('startTime');
  await expect(header).toContainText('duration');
  await expect(header).toContainText('spanCount');
  await expect(header).toContainText('errorCount');
  await expect(header).toContainText('services');

  // At least one data row should be present
  const dataRows = table.getByRole('row').filter({ hasNot: explorePage.ctx.page.getByRole('columnheader') });
  await expect(dataRows.first()).toBeVisible();
});
