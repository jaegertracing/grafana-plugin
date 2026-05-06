import { PanelPlugin } from '@grafana/data';
import { JaegerPanelOptions } from './types';
import { SimplePanel } from './components/SimplePanel';

export const plugin = new PanelPlugin<JaegerPanelOptions>(SimplePanel).setPanelOptions((builder) => {
  return builder
    .addRadio({
      path: 'mode',
      name: 'Mode',
      defaultValue: 'trace',
      settings: {
        options: [
          { value: 'trace', label: 'Single trace' },
          { value: 'diff', label: 'Trace diff' },
          { value: 'search', label: 'Search' },
        ],
      },
    })
    .addTextInput({
      path: 'jaegerBaseUrl',
      name: 'Jaeger UI base URL',
      description: 'Base URL of the Jaeger Query service, e.g. http://localhost:16686',
      defaultValue: 'http://localhost:16686',
    })
    .addTextInput({
      path: 'traceId',
      name: 'Trace ID',
      defaultValue: '',
      showIf: (o) => o.mode === 'trace' || o.mode === 'diff',
    })
    .addTextInput({
      path: 'traceIdB',
      name: 'Trace ID (B)',
      description: 'Second trace ID for diff mode',
      defaultValue: '',
      showIf: (o) => o.mode === 'diff',
    });
});
