import { FieldType } from '@grafana/data';
import { getBackendSrv, getTemplateSrv } from '@grafana/runtime';
import { of, throwError } from 'rxjs';
import { JaegerDataSource } from './datasource';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
  getTemplateSrv: jest.fn(),
  isFetchError: jest.fn((e: unknown) => (e as any)?.__isFetchError === true),
}));

const mockGetBackendSrv = getBackendSrv as jest.Mock;
const mockGetTemplateSrv = getTemplateSrv as jest.Mock;

function makeInstance(url = 'http://localhost:16686', publicUrl?: string) {
  return new JaegerDataSource({
    uid: 'test-uid',
    id: 1,
    name: 'Jaeger',
    type: 'jaegertracing-jaeger-datasource',
    url,
    access: 'proxy',
    jsonData: publicUrl ? { publicUrl } : {},
    readOnly: false,
  } as any);
}

beforeEach(() => {
  mockGetTemplateSrv.mockReturnValue({ replace: (s: string) => s });
});

describe('JaegerDataSource — constructor', () => {
  it('uses instanceSettings.url as baseUrl', () => {
    const ds = makeInstance('http://jaeger.example.com/jaeger');
    expect(ds.baseUrl).toBe('http://jaeger.example.com/jaeger');
  });

  it('uses jsonData.publicUrl as publicUrl', () => {
    const ds = makeInstance('http://jaeger:16686', 'http://localhost:16686');
    expect(ds.publicUrl).toBe('http://localhost:16686');
  });

  it('publicUrl defaults to empty string when not set', () => {
    const ds = makeInstance('http://jaeger:16686');
    expect(ds.publicUrl).toBe('');
  });
});

describe('JaegerDataSource — testDatasource', () => {
  it('returns success when /api/v3/services responds', async () => {
    const fetch = jest.fn().mockReturnValue(of({ data: { services: ['frontend'] } }));
    mockGetBackendSrv.mockReturnValue({ fetch });
    const ds = makeInstance();
    const result = await ds.testDatasource();
    expect(result.status).toBe('success');
    expect(result.message).toContain('Successfully connected');
    expect(fetch).toHaveBeenCalledWith({ url: 'http://localhost:16686/api/v3/services' });
  });

  it('returns error when fetch throws', async () => {
    mockGetBackendSrv.mockReturnValue({
      fetch: jest.fn().mockReturnValue(throwError(() => new Error('ECONNREFUSED'))),
    });
    const ds = makeInstance();
    const result = await ds.testDatasource();
    expect(result.status).toBe('error');
    expect(result.message).toContain('Cannot connect');
  });
});

describe('JaegerDataSource — getServices', () => {
  it('returns service list from API', async () => {
    const fetch = jest.fn().mockReturnValue(of({ data: { services: ['frontend', 'driver'] } }));
    mockGetBackendSrv.mockReturnValue({ fetch });
    const ds = makeInstance();
    const services = await ds.getServices();
    expect(services).toEqual(['frontend', 'driver']);
    expect(fetch).toHaveBeenCalledWith({ url: 'http://localhost:16686/api/v3/services' });
  });

  it('returns an empty list when the response carries no services', async () => {
    mockGetBackendSrv.mockReturnValue({ fetch: jest.fn().mockReturnValue(of({ data: {} })) });
    const ds = makeInstance();
    expect(await ds.getServices()).toEqual([]);
  });
});

describe('JaegerDataSource — getOperations', () => {
  it('returns operation names and passes the service as a query parameter', async () => {
    const fetch = jest.fn().mockReturnValue(
      of({
        data: {
          operations: [
            { name: 'HTTP GET /route', spanKind: 'server' },
            { name: '/driver.DriverService/FindNearest', spanKind: 'client' },
          ],
        },
      })
    );
    mockGetBackendSrv.mockReturnValue({ fetch });
    const ds = makeInstance();
    const operations = await ds.getOperations('abc/trifle');
    expect(operations).toEqual(['HTTP GET /route', '/driver.DriverService/FindNearest']);
    expect(fetch).toHaveBeenCalledWith({
      url: 'http://localhost:16686/api/v3/operations?service=abc%2Ftrifle',
    });
  });

  it('returns an empty list when the response carries no operations', async () => {
    mockGetBackendSrv.mockReturnValue({ fetch: jest.fn().mockReturnValue(of({ data: {} })) });
    const ds = makeInstance();
    expect(await ds.getOperations('frontend')).toEqual([]);
  });
});

describe('JaegerDataSource — query (trace mode)', () => {
  it('returns single-row traceID frame without making an API call', async () => {
    const fetch = jest.fn();
    mockGetBackendSrv.mockReturnValue({ fetch });
    const ds = makeInstance();
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'trace', traceId: 'abc123' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);

    expect(fetch).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
    const frame = result.data[0];
    expect(frame.name).toBe('abc123');
    expect(frame.length).toBe(1);
    const field = frame.fields.find((f: any) => f.name === 'traceID' && f.type === FieldType.string);
    expect(field).toBeDefined();
    expect(field.values[0]).toBe('abc123');
  });

  it('returns empty data when traceId is blank', async () => {
    mockGetBackendSrv.mockReturnValue({ fetch: jest.fn() });
    const ds = makeInstance();
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'trace', traceId: '' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);
    expect(result.data).toHaveLength(0);
  });
});

// Exact decimal strings of Unix nanoseconds (proto3 fixed64 convention).
// Must be string literals — these values exceed Number.MAX_SAFE_INTEGER and would
// lose precision if written as JS numeric literals before stringification.
const minStartNs = '1700000000000000000'; // 2023-11-14T22:13:20.000Z
const maxEndNs = '1700000000500000000'; // +500ms

const mockSummary = {
  traceId: 'trace1',
  rootServiceName: 'frontend',
  rootOperationName: 'HTTP GET /dispatch',
  minStartTimeUnixNano: minStartNs,
  maxEndTimeUnixNano: maxEndNs,
  spanCount: 42,
  errorSpanCount: 2,
  orphanSpanCount: 0,
  services: [
    { name: 'backend', spanCount: 30, errorSpanCount: 2 },
    { name: 'frontend', spanCount: 12, errorSpanCount: 0 },
  ],
};

describe('JaegerDataSource — query (search mode)', () => {
  it('calls /api/v3/trace-summaries with correct params and returns a traces frame', async () => {
    const fetch = jest.fn().mockReturnValue(of({ data: { summaries: [mockSummary] } }));
    mockGetBackendSrv.mockReturnValue({ fetch });

    const ds = makeInstance('http://jaeger.example.com/jaeger');
    const from = { valueOf: () => 1000 };
    const to = { valueOf: () => 2000 };
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: 'frontend', limit: 5 }],
      range: { from, to } as any,
    } as any);

    const [callArg] = fetch.mock.calls[0];
    expect(callArg.url).toContain('jaeger.example.com/jaeger/api/v3/trace-summaries');
    expect(callArg.url).toContain('query.serviceName=frontend');
    expect(callArg.url).toContain('query.searchDepth=5');
    expect(callArg.url).toContain('query.startTimeMin=');

    expect(result.data).toHaveLength(1);
    const frame = result.data[0];
    expect(frame.name).toBe('traces');

    const traceIdField = frame.fields.find((f: any) => f.name === 'traceID');
    expect(traceIdField.values[0]).toBe('trace1');

    const traceNameField = frame.fields.find((f: any) => f.name === 'traceName');
    expect(traceNameField.values[0]).toBe('frontend: HTTP GET /dispatch');

    const spanCountField = frame.fields.find((f: any) => f.name === 'spanCount');
    expect(spanCountField.values[0]).toBe(42);

    const errorField = frame.fields.find((f: any) => f.name === 'errorCount');
    expect(errorField.values[0]).toBe(2);

    const servicesField = frame.fields.find((f: any) => f.name === 'services');
    expect(servicesField.values[0]).toBe('backend(30,⚠2) frontend(12)');

    const durationField = frame.fields.find((f: any) => f.name === 'duration');
    expect(durationField.values[0]).toBeCloseTo(500_000, -1); // 500ms in µs
  });

  it('supplies a default limit, so a search carrying only a time range is not treated as empty', () => {
    // Grafana's Explore refuses to run a query whose every field is empty, and it does not
    // count queryType. Without this default, clearing the Service field left nothing to run.
    expect(makeInstance().getDefaultQuery()).toMatchObject({ queryType: 'search', limit: 20 });
  });

  it('searches without a service name, letting the backend decide', async () => {
    const fetch = jest.fn().mockReturnValue(of({ data: { summaries: [mockSummary] } }));
    mockGetBackendSrv.mockReturnValue({ fetch });

    const ds = makeInstance();
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: '' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);

    const [callArg] = fetch.mock.calls[0];
    expect(callArg.url).toContain('/api/v3/trace-summaries');
    expect(callArg.url).toContain('query.serviceName=&');
    expect(result.data).toHaveLength(1);
  });

  it('surfaces the error from a backend that requires a service name', async () => {
    // Backends that key their indices by service name reject the query; Jaeger answers
    // 400 with an explanation, and Grafana shows it instead of an empty panel.
    const fetch = jest.fn().mockReturnValue(
      throwError(() => ({
        status: 400,
        data: { message: 'this storage backend requires a service name to search' },
      }))
    );
    mockGetBackendSrv.mockReturnValue({ fetch });

    const ds = makeInstance();
    await expect(
      ds.query({
        targets: [{ refId: 'A', queryType: 'search', service: '' }],
        range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
      } as any)
    ).rejects.toMatchObject({ status: 400 });
  });

  it('applies template variable interpolation', async () => {
    mockGetTemplateSrv.mockReturnValue({ replace: (s: string) => s.replace('${svc}', 'driver') });
    const fetch = jest.fn().mockReturnValue(of({ data: { summaries: [] } }));
    mockGetBackendSrv.mockReturnValue({ fetch });

    const ds = makeInstance('http://localhost:16686');
    await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: '${svc}' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);

    const [callArg] = fetch.mock.calls[0];
    expect(callArg.url).toContain('query.serviceName=driver');
  });

  it('encodes logfmt tags as query.attributes JSON map', async () => {
    const fetch = jest.fn().mockReturnValue(of({ data: { summaries: [] } }));
    mockGetBackendSrv.mockReturnValue({ fetch });

    const ds = makeInstance('http://localhost:16686');
    await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: 'frontend', tags: 'error=true driver=T702693C' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);

    const [callArg] = fetch.mock.calls[0];
    const attrs = JSON.parse(new URL(callArg.url).searchParams.get('query.attributes')!);
    expect(attrs).toEqual({ error: 'true', driver: 'T702693C' });
  });

  it('handles quoted values in logfmt tags', async () => {
    const fetch = jest.fn().mockReturnValue(of({ data: { summaries: [] } }));
    mockGetBackendSrv.mockReturnValue({ fetch });

    const ds = makeInstance('http://localhost:16686');
    await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: 'frontend', tags: 'db.statement="select * from User"' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);

    const [callArg] = fetch.mock.calls[0];
    const attrs = JSON.parse(new URL(callArg.url).searchParams.get('query.attributes')!);
    expect(attrs).toEqual({ 'db.statement': 'select * from User' });
  });

  it('skips hidden targets', async () => {
    const fetch = jest.fn();
    mockGetBackendSrv.mockReturnValue({ fetch });
    const ds = makeInstance();
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: 'frontend', hide: true }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(0);
  });
});
