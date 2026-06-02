import {
  DataLink,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  FieldType,
  TimeRange,
  createDataFrame,
} from '@grafana/data';
import { getBackendSrv, getTemplateSrv, isFetchError } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { JaegerDataSourceOptions, JaegerQuery } from '../types';

export class JaegerDataSource extends DataSourceApi<JaegerQuery, JaegerDataSourceOptions> {
  readonly baseUrl: string;
  readonly publicUrl: string;

  constructor(instanceSettings: DataSourceInstanceSettings<JaegerDataSourceOptions>) {
    super(instanceSettings);
    // baseUrl: the Grafana DataProxy path used for server-side API calls (no CORS needed).
    this.baseUrl = (instanceSettings.url ?? '').replace(/\/+$/, '');
    // publicUrl: the browser-accessible Jaeger URL used for the panel iframe.
    this.publicUrl = (instanceSettings.jsonData.publicUrl ?? '').replace(/\/+$/, '');
  }

  async query(request: DataQueryRequest<JaegerQuery>): Promise<DataQueryResponse> {
    const results = await Promise.all(
      request.targets
        .filter((target) => !target.hide)
        .map((target) => this.runQuery(target, request.range))
    );
    return { data: results.flat() };
  }

  private async runQuery(query: JaegerQuery, range: TimeRange): Promise<Array<ReturnType<typeof createDataFrame>>> {
    const interpolated: JaegerQuery = {
      ...query,
      traceId: query.traceId ? getTemplateSrv().replace(query.traceId) : query.traceId,
      service: query.service ? getTemplateSrv().replace(query.service) : query.service,
      operation: query.operation ? getTemplateSrv().replace(query.operation) : query.operation,
      tags: query.tags ? getTemplateSrv().replace(query.tags) : query.tags,
    };
    if (interpolated.queryType === 'trace') {
      return Promise.resolve(interpolated.traceId ? this.fetchTrace(interpolated.traceId) : []);
    }
    return interpolated.service ? this.fetchTraces(interpolated, range) : [];
  }

  private fetchTrace(traceId: string): Array<ReturnType<typeof createDataFrame>> {
    // No API call needed: the panel renders the trace via iframe, which fetches it directly.
    return [createDataFrame({
      name: traceId,
      meta: { preferredVisualisationPluginId: 'jaegertracing-jaeger-panel' },
      fields: [{ name: 'traceID', type: FieldType.string, values: [traceId] }],
    })];
  }

  private async fetchTraces(query: JaegerQuery, range: TimeRange): Promise<Array<ReturnType<typeof createDataFrame>>> {
    const params = new URLSearchParams();
    params.set('query.serviceName', query.service ?? '');
    // v3 API expects RFC3339Nano timestamps
    params.set('query.startTimeMin', new Date(range.from.valueOf()).toISOString());
    params.set('query.startTimeMax', new Date(range.to.valueOf()).toISOString());
    if (query.operation) {
      params.set('query.operationName', query.operation);
    }
    if (query.limit) {
      params.set('query.searchDepth', String(query.limit));
    }
    if (query.minDuration) {
      params.set('query.durationMin', query.minDuration);
    }
    if (query.maxDuration) {
      params.set('query.durationMax', query.maxDuration);
    }
    if (query.tags) {
      // Tags field is "key:value" pairs separated by whitespace; v3 API expects JSON map.
      const attrsMap: Record<string, string> = {};
      for (const pair of query.tags.trim().split(/\s+/)) {
        const colon = pair.indexOf(':');
        if (colon > 0) {
          attrsMap[pair.slice(0, colon)] = pair.slice(colon + 1);
        }
      }
      if (Object.keys(attrsMap).length > 0) {
        params.set('query.attributes', JSON.stringify(attrsMap));
      }
    }

    interface ServiceSummary {
      name: string;
      spanCount: number;
      errorSpanCount: number;
    }
    interface TraceSummary {
      traceId: string;
      rootServiceName: string;
      rootOperationName: string;
      minStartTimeUnixNano: string;
      maxEndTimeUnixNano: string;
      spanCount: number;
      errorSpanCount: number;
      orphanSpanCount: number;
      services: ServiceSummary[];
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<{ summaries: TraceSummary[] }>({
        url: `${this.baseUrl}/api/v3/trace-summaries?${params}`,
      })
    );

    const traceLink: DataLink = {
      title: 'Open in Explore',
      url: '',
      internal: {
        datasourceUid: this.uid,
        datasourceName: this.name,
        query: { queryType: 'trace', traceId: '${__value.raw}' },
      },
    };

    const traceIDs: string[] = [];
    const traceNames: string[] = [];
    const startTimes: number[] = [];
    const durations: number[] = [];
    const spanCounts: number[] = [];
    const errorSpanCounts: number[] = [];
    const serviceBreakdowns: string[] = [];

    for (const s of response.data.summaries ?? []) {
      // Timestamps are decimal strings of Unix nanoseconds (proto3 fixed64 → string).
      // Epoch ns values (~1.7e18) exceed Number.MAX_SAFE_INTEGER, so we must not call
      // parseInt on the full string. Truncate to µs in string space (drop last 3 digits)
      // before parsing — 16-digit µs values are within safe integer range (~1.7e15 < 2^53).
      const nsToUs = (ns: string) => parseInt((ns || '0').slice(0, -3) || '0', 10);
      const minUs = nsToUs(s.minStartTimeUnixNano);
      const maxUs = nsToUs(s.maxEndTimeUnixNano);
      const durationUs = maxUs - minUs;
      const startTimeMs = minUs / 1000;

      const servicesStr = (s.services ?? [])
        .map((svc) =>
          svc.errorSpanCount > 0
            ? `${svc.name}(${svc.spanCount},⚠${svc.errorSpanCount})`
            : `${svc.name}(${svc.spanCount})`
        )
        .join(' ');

      const name =
        s.rootServiceName && s.rootOperationName
          ? `${s.rootServiceName}: ${s.rootOperationName}`
          : s.rootOperationName || s.rootServiceName;

      traceIDs.push(s.traceId);
      traceNames.push(name);
      startTimes.push(startTimeMs);
      durations.push(durationUs);
      spanCounts.push(s.spanCount);
      errorSpanCounts.push(s.errorSpanCount);
      serviceBreakdowns.push(servicesStr);
    }

    return [createDataFrame({
      name: 'traces',
      fields: [
        { name: 'traceID', type: FieldType.string, values: traceIDs, config: { links: [traceLink] } },
        { name: 'traceName', type: FieldType.string, values: traceNames },
        { name: 'startTime', type: FieldType.time, values: startTimes },
        { name: 'duration', type: FieldType.number, values: durations, config: { unit: 'µs' } },
        { name: 'spanCount', type: FieldType.number, values: spanCounts },
        { name: 'errorSpanCount', type: FieldType.number, values: errorSpanCounts },
        { name: 'services', type: FieldType.string, values: serviceBreakdowns },
      ],
    })];
  }

  async testDatasource(): Promise<{ status: string; message: string }> {
    try {
      await lastValueFrom(
        getBackendSrv().fetch({
          url: `${this.baseUrl}/api/services`,
        })
      );
      return { status: 'success', message: 'Successfully connected to Jaeger' };
    } catch (err) {
      const msg = isFetchError(err) ? `HTTP ${err.status}: ${err.statusText}` : String(err);
      return { status: 'error', message: `Cannot connect to Jaeger: ${msg}` };
    }
  }

  async getServices(): Promise<string[]> {
    const response = await lastValueFrom(
      getBackendSrv().fetch<{ data: string[] }>({
        url: `${this.baseUrl}/api/services`,
      })
    );
    return response.data.data ?? [];
  }

  async getOperations(service: string): Promise<string[]> {
    const response = await lastValueFrom(
      getBackendSrv().fetch<{ data: string[] }>({
        url: `${this.baseUrl}/api/services/${encodeURIComponent(service)}/operations`,
      })
    );
    return response.data.data ?? [];
  }
}
