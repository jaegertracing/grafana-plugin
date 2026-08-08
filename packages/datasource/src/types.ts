import { DataQuery } from '@grafana/schema';
import { DataSourceJsonData } from '@grafana/data';

export interface JaegerDataSourceOptions extends DataSourceJsonData {
  publicUrl?: string;
}

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

// Grafana's Explore refuses to run a query it considers empty, and it ignores queryType when
// deciding that. A search needs no field but the time range, so limit is set to keep such a
// query runnable — 20 is the default the Limit field has always shown as its placeholder.
export const DEFAULT_SEARCH_LIMIT = 20;

export const DEFAULT_QUERY: Partial<JaegerQuery> = {
  queryType: 'search',
  limit: DEFAULT_SEARCH_LIMIT,
};
