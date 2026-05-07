import { test, expect } from '@grafana/plugin-e2e';

test('trace mode shows hint when no trace ID is set', async ({ gotoPanelEditPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  // Panel 2 is the trace detail panel; $traceId defaults to empty → shows hint
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(panelEditPage.panel.locator).toContainText('Enter a Trace ID in panel options.');
});

test('trace mode renders iframe when trace ID is provided via panel options', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  // Set traceId option directly
  await panelEditPage.setFieldConfigOverride('traceId', 'abc123');
  const iframe = panelEditPage.panel.locator.locator('[data-testid="jaeger-panel-iframe"]');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', /\/trace\/abc123/);
  await expect(iframe).toHaveAttribute('src', /uiEmbed=v0/);
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
  // At least one option should appear (from the live Jaeger API via proxy)
  await expect(explorePage.page.getByRole('option').first()).toBeVisible();
});
