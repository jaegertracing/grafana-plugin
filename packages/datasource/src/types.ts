import { DataQuery, DataSourceJsonData } from '@grafana/data';

export interface JaegerQuery extends DataQuery {
  traceId?: string;
  service?: string;
  operation?: string;
  tags?: string;
  minDuration?: string;
  maxDuration?: string;
  limit?: number;
  queryType?: 'trace' | 'search';
}

export interface JaegerDataSourceOptions extends DataSourceJsonData {
  // proxyMode routes iframe src and API calls through the Grafana backend proxy (Go binary).
  // When false (default), the panel uses jaegerBaseUrl directly from panel options.
  proxyMode?: boolean;
  // jaegerInternalURL is the internal Jaeger address used by the Go proxy (proxy mode only).
  jaegerInternalURL?: string;
}

export const DEFAULT_QUERY: Partial<JaegerQuery> = {
  queryType: 'search',
};
