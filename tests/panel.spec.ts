import { test, expect } from '@grafana/plugin-e2e';

test('trace mode shows hint when no trace ID is set', async ({ gotoPanelEditPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  // Panel 1 has mode=trace and traceId="${traceId}" which defaults to empty
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  await expect(panelEditPage.panel.locator).toContainText('Enter a Trace ID in panel options.');
});

test('diff mode shows hint when trace IDs are not set', async ({ gotoPanelEditPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  // Panel 3 has mode=diff with empty traceId and traceIdB
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '3' });
  await expect(panelEditPage.panel.locator).toContainText('Enter two Trace IDs in panel options.');
});

test('search mode shows hint when no service is set', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  // Panel 2 has mode=search with no service — must show hint, not a broken iframe
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(panelEditPage.panel.locator).toContainText('Enter a Service name in panel options.');
});

test('search mode renders iframe with correct URL when service is set', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  // Panel 5 has mode=search with service=frontend
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '5' });
  const iframe = panelEditPage.panel.locator.locator('[data-testid="jaeger-panel-iframe"]');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', /\/search\?/);
  await expect(iframe).toHaveAttribute('src', /uiEmbed=v0/);
  await expect(iframe).toHaveAttribute('src', /uiSearchHideGraph=1/);
  await expect(iframe).toHaveAttribute('src', /service=frontend/);
});

test('trace mode renders iframe with correct src when trace ID is set', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  // Panel 4 has mode=trace with hardcoded traceId="abc123"
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '4' });
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
