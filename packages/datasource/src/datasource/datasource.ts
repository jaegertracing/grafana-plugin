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

// parseLogfmt parses Jaeger's logfmt tag format: space-separated key=value pairs,
// with quoted values for strings containing spaces.
// e.g. `error=true db.statement="select * from User"`
function parseLogfmt(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\S+?)=("(?:[^"\\]|\\.)*"|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const key = match[1];
    const raw = match[2];
    result[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw;
  }
  return result;
}

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
      // Tags use logfmt: key=value pairs, quoted values allowed for strings with spaces.
      // Unquoted values may contain '=' (split on first '='). Matches Jaeger UI tag format.
      const attrsMap = parseLogfmt(query.tags);
      if (Object.keys(attrsMap).length > 0) {
        params.set('query.attributes', JSON.stringify(attrsMap));
      }
    }

    interface ServiceSummary {
      name: string;
      spanCount?: number;
      errorSpanCount?: number;
    }
    interface TraceSummary {
      traceId: string;
      rootServiceName?: string;
      rootOperationName?: string;
      minStartTimeUnixNano?: string;
      maxEndTimeUnixNano?: string;
      spanCount?: number;
      errorSpanCount?: number;
      orphanSpanCount?: number;
      services?: ServiceSummary[];
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
    const startTimes: Array<number | null> = [];
    const durations: Array<number | null> = [];
    const spanCounts: number[] = [];
    const errorSpanCounts: number[] = [];
    const serviceBreakdowns: string[] = [];

    for (const s of response.data.summaries ?? []) {
      // Timestamps are decimal strings of Unix nanoseconds (proto3 fixed64 → string).
      // Epoch ns values (~1.7e18) exceed Number.MAX_SAFE_INTEGER, so we must not call
      // parseInt on the full string. Truncate to µs in string space (drop last 3 digits)
      // before parsing — 16-digit µs values are within safe integer range (~1.7e15 < 2^53).
      // Truncate ns→µs in string space before parseInt to stay within float64 precision.
      // Treat missing/empty timestamps as null rather than 0 to avoid bogus 1970 startTime.
      const nsToUs = (ns: string | undefined): number | null => {
        if (!ns) { return null; }
        const us = parseInt(ns.slice(0, -3) || '0', 10);
        return isNaN(us) ? null : us;
      };
      const minUs = nsToUs(s.minStartTimeUnixNano);
      const maxUs = nsToUs(s.maxEndTimeUnixNano);
      const durationUs = minUs !== null && maxUs !== null ? maxUs - minUs : null;
      const startTimeMs = minUs !== null ? minUs / 1000 : null;

      const servicesStr = (s.services ?? [])
        .map((svc) =>
          (svc.errorSpanCount ?? 0) > 0
            ? `${svc.name}(${svc.spanCount ?? 0},⚠${svc.errorSpanCount})`
            : `${svc.name}(${svc.spanCount ?? 0})`
        )
        .join(' ');

      const name =
        s.rootServiceName && s.rootOperationName
          ? `${s.rootServiceName}: ${s.rootOperationName}`
          : s.rootOperationName ?? s.rootServiceName ?? '';

      traceIDs.push(s.traceId);
      traceNames.push(name);
      startTimes.push(startTimeMs);
      durations.push(durationUs);
      spanCounts.push(s.spanCount ?? 0);
      errorSpanCounts.push(s.errorSpanCount ?? 0);
      serviceBreakdowns.push(servicesStr);
    }

    return [createDataFrame({
      name: 'traces',
      fields: [
        { name: 'traceID', type: FieldType.string, values: traceIDs, config: { links: [traceLink], custom: { width: 200 } } },
        { name: 'traceName', type: FieldType.string, values: traceNames, config: { custom: { width: 300 } } },
        { name: 'startTime', type: FieldType.time, values: startTimes, config: { custom: { width: 180 } } },
        { name: 'duration', type: FieldType.number, values: durations, config: { unit: 'µs', custom: { width: 100 } } },
        { name: 'spanCount', type: FieldType.number, values: spanCounts, config: { custom: { width: 90 } } },
        { name: 'errorCount', type: FieldType.number, values: errorSpanCounts, config: { custom: { width: 90 } } },
        { name: 'services', type: FieldType.string, values: serviceBreakdowns, config: { custom: { minWidth: 200 } } },
      ],
    })];
  }

  async testDatasource(): Promise<{ status: string; message: string }> {
    try {
      await lastValueFrom(
        getBackendSrv().fetch({
          url: `${this.baseUrl}/api/v3/services`,
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
      getBackendSrv().fetch<{ services: string[] }>({
        url: `${this.baseUrl}/api/v3/services`,
      })
    );
    return response.data.services ?? [];
  }

  // api_v3 reports an operation as a name plus a span kind; the query editor only shows names.
  async getOperations(service: string): Promise<string[]> {
    const response = await lastValueFrom(
      getBackendSrv().fetch<{ operations: Array<{ name: string; spanKind: string }> }>({
        url: `${this.baseUrl}/api/v3/operations?service=${encodeURIComponent(service)}`,
      })
    );
    return response.data.operations?.map((operation) => operation.name) ?? [];
  }
}
