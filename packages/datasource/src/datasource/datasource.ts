import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  FieldType,
  MutableDataFrame,
} from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { JaegerDataSourceOptions, JaegerQuery } from '../types';

export class JaegerDataSource extends DataSourceApi<JaegerQuery, JaegerDataSourceOptions> {
  jaegerUrl: string;

  constructor(instanceSettings: DataSourceInstanceSettings<JaegerDataSourceOptions>) {
    super(instanceSettings);
    this.jaegerUrl = instanceSettings.jsonData.jaegerUrl ?? '';
  }

  async query(request: DataQueryRequest<JaegerQuery>): Promise<DataQueryResponse> {
    const results = await Promise.all(
      request.targets
        .filter((target) => !target.hide)
        .map((target) => this.runQuery(target))
    );
    return { data: results.flat() };
  }

  private async runQuery(query: JaegerQuery): Promise<MutableDataFrame[]> {
    if (query.queryType === 'trace' && query.traceId) {
      return this.fetchTrace(query.traceId);
    }
    if (query.service) {
      return this.fetchTraces(query);
    }
    return [];
  }

  private async fetchTrace(traceId: string): Promise<MutableDataFrame[]> {
    const response = await lastValueFrom(
      getBackendSrv().fetch<{ data: unknown[] }>({
        url: `${this.url}/api/traces/${encodeURIComponent(traceId)}`,
      })
    );
    const frame = new MutableDataFrame({
      name: traceId,
      fields: [{ name: 'traceID', type: FieldType.string }],
    });
    frame.add({ traceID: traceId });
    return [frame];
  }

  private async fetchTraces(query: JaegerQuery): Promise<MutableDataFrame[]> {
    const params = new URLSearchParams({ service: query.service ?? '' });
    if (query.operation) {
      params.set('operation', query.operation);
    }
    if (query.limit) {
      params.set('limit', String(query.limit));
    }
    if (query.minDuration) {
      params.set('minDuration', query.minDuration);
    }
    if (query.maxDuration) {
      params.set('maxDuration', query.maxDuration);
    }
    if (query.tags) {
      params.set('tags', query.tags);
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<{ data: Array<{ traceID: string; spans: unknown[] }> }>({
        url: `${this.url}/api/traces?${params}`,
      })
    );

    const frame = new MutableDataFrame({
      name: 'traces',
      fields: [
        { name: 'traceID', type: FieldType.string },
        { name: 'spanCount', type: FieldType.number },
      ],
    });

    for (const trace of response.data.data ?? []) {
      frame.add({
        traceID: trace.traceID,
        spanCount: Array.isArray(trace.spans) ? trace.spans.length : 0,
      });
    }

    return [frame];
  }

  async testDatasource(): Promise<{ status: string; message: string }> {
    try {
      await lastValueFrom(
        getBackendSrv().fetch({
          url: `${this.url}/api/services`,
        })
      );
      return { status: 'success', message: 'Successfully connected to Jaeger' };
    } catch (err) {
      return { status: 'error', message: `Cannot connect to Jaeger: ${String(err)}` };
    }
  }

  async getServices(): Promise<string[]> {
    const response = await lastValueFrom(
      getBackendSrv().fetch<{ data: string[] }>({
        url: `${this.url}/api/services`,
      })
    );
    return response.data.data ?? [];
  }

  async getOperations(service: string): Promise<string[]> {
    const response = await lastValueFrom(
      getBackendSrv().fetch<{ data: string[] }>({
        url: `${this.url}/api/services/${encodeURIComponent(service)}/operations`,
      })
    );
    return response.data.data ?? [];
  }
}
