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
  it('returns success when /api/services responds', async () => {
    mockGetBackendSrv.mockReturnValue({
      fetch: jest.fn().mockReturnValue(of({ data: { data: ['frontend'] } })),
    });
    const ds = makeInstance();
    const result = await ds.testDatasource();
    expect(result.status).toBe('success');
    expect(result.message).toContain('Successfully connected');
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
    mockGetBackendSrv.mockReturnValue({
      fetch: jest.fn().mockReturnValue(of({ data: { data: ['frontend', 'driver'] } })),
    });
    const ds = makeInstance();
    const services = await ds.getServices();
    expect(services).toEqual(['frontend', 'driver']);
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

// 1_000_000_000 ns = 1s; encode as decimal strings (proto3 fixed64 convention)
const minStartNs = String(1_700_000_000_000_000_000); // 2023-11-14T22:13:20.000Z
const maxEndNs   = String(1_700_000_000_500_000_000); // +500ms

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

    const errorField = frame.fields.find((f: any) => f.name === 'errorSpanCount');
    expect(errorField.values[0]).toBe(2);

    const servicesField = frame.fields.find((f: any) => f.name === 'services');
    expect(servicesField.values[0]).toBe('backend(30,⚠2) frontend(12)');

    const durationField = frame.fields.find((f: any) => f.name === 'duration');
    expect(durationField.values[0]).toBeCloseTo(500_000, -1); // 500ms in µs
  });

  it('returns empty data when no service is provided', async () => {
    mockGetBackendSrv.mockReturnValue({ fetch: jest.fn() });
    const ds = makeInstance();
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: '' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);
    expect(result.data).toHaveLength(0);
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
