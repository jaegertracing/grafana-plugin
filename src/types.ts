export type PanelMode = 'trace' | 'diff' | 'search';

export interface JaegerPanelOptions {
  jaegerBaseUrl: string;
  mode: PanelMode;
  traceId: string;
  traceIdB: string;
}
