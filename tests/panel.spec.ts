import { test, expect } from '@grafana/plugin-e2e';

test('trace mode shows hint when no trace ID is set', async ({ gotoPanelEditPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  // Panel 2 is the trace detail panel; $traceId defaults to empty → shows hint
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(panelEditPage.panel.locator).toContainText('Enter a Trace ID in panel options.');
});

test('datasource testDatasource succeeds', async ({
  readProvisionedDataSource,
  gotoDataSourceConfigPage,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const configPage = await gotoDataSourceConfigPage(datasource.uid);
  await expect(configPage.saveAndTest()).resolves.toBeDefined();
  await expect(configPage.page.getByText('Successfully connected to Jaeger')).toBeVisible();
});

test('datasource QueryEditor service dropdown is populated from live Jaeger API', async ({
  readProvisionedDataSource,
  explorePage,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await explorePage.goto();
  await explorePage.datasource.set(datasource.name);
  // The QueryEditor renders a Service select; wait for it to be populated
  const serviceSelect = explorePage.getQueryEditorRow('A').getByRole('combobox', { name: /service/i });
  await serviceSelect.click();
  // Assert a known HotROD service appears — verifies the live Jaeger API was actually queried
  await expect(explorePage.page.getByRole('option', { name: 'frontend' })).toBeVisible();
});

test('search query returns trace-summaries result table with expected columns', async ({
  readProvisionedDataSource,
  explorePage,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await explorePage.goto();
  await explorePage.datasource.set(datasource.name);

  // Select the 'frontend' service and run the query
  const row = explorePage.getQueryEditorRow('A');
  const serviceSelect = row.getByRole('combobox', { name: /service/i });
  await serviceSelect.click();
  await explorePage.page.getByRole('option', { name: 'frontend' }).click();
  await explorePage.page.getByRole('button', { name: /run query/i }).click();

  // The results table should contain the columns returned by /api/v3/trace-summaries
  const table = explorePage.page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 10000 });
  const header = table.getByRole('row').first();
  await expect(header).toContainText('traceID');
  await expect(header).toContainText('startTime');
  await expect(header).toContainText('duration');
  await expect(header).toContainText('spanCount');
  await expect(header).toContainText('errorSpanCount');
  await expect(header).toContainText('services');

  // At least one data row should be present
  const dataRows = table.getByRole('row').filter({ hasNot: explorePage.page.getByRole('columnheader') });
  await expect(dataRows.first()).toBeVisible();
});
