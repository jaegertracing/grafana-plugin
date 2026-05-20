import { FieldType } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { JaegerDataSource } from './datasource';

jest.mock('@grafana/runtime', () => ({
  getTemplateSrv: jest.fn(),
}));

const mockGetTemplateSrv = getTemplateSrv as jest.Mock;

function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeInstance(url = 'http://localhost:16686') {
  return new JaegerDataSource({
    uid: 'test-uid',
    id: 1,
    name: 'Jaeger',
    type: 'jaegertracing-jaeger-datasource',
    url,
    access: 'proxy',
    jsonData: {},
    readOnly: false,
  } as any);
}

beforeEach(() => {
  mockGetTemplateSrv.mockReturnValue({ replace: (s: string) => s });
  globalThis.fetch = jest.fn() as typeof fetch;
});

describe('JaegerDataSource — constructor', () => {
  it('uses instanceSettings.url as baseUrl', () => {
    const ds = makeInstance('http://jaeger.example.com/jaeger');
    expect(ds.baseUrl).toBe('http://jaeger.example.com/jaeger');
  });
});

describe('JaegerDataSource — testDatasource', () => {
  it('returns success when /api/services responds', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse({ data: ['frontend'] }));
    const ds = makeInstance();
    const result = await ds.testDatasource();
    expect(result.status).toBe('success');
    expect(result.message).toContain('Successfully connected');
  });

  it('returns error when fetch throws', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
    const ds = makeInstance();
    const result = await ds.testDatasource();
    expect(result.status).toBe('error');
    expect(result.message).toContain('Cannot connect');
  });
});

describe('JaegerDataSource — getServices', () => {
  it('returns service list from API', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse({ data: ['frontend', 'driver'] }));
    const ds = makeInstance();
    const services = await ds.getServices();
    expect(services).toEqual(['frontend', 'driver']);
  });
});

describe('JaegerDataSource — query (trace mode)', () => {
  it('returns single-row traceID frame without making an API call', async () => {
    const ds = makeInstance();
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'trace', traceId: 'abc123' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
    const frame = result.data[0];
    expect(frame.name).toBe('abc123');
    expect(frame.length).toBe(1);
    const field = frame.fields.find((f: any) => f.name === 'traceID' && f.type === FieldType.string);
    expect(field).toBeDefined();
    expect(field.values[0]).toBe('abc123');
  });

  it('returns empty data when traceId is blank', async () => {
    const ds = makeInstance();
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'trace', traceId: '' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);
    expect(result.data).toHaveLength(0);
  });
});

describe('JaegerDataSource — query (search mode)', () => {
  it('calls /api/traces with correct params and returns a traces frame', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse({
      data: [
        {
          traceID: 'trace1',
          spans: [
            {
              spanID: 's1',
              operationName: 'HTTP GET /dispatch',
              duration: 5000,
              startTime: 1000,
              processID: 'p1',
              references: [],
            },
          ],
          processes: { p1: { serviceName: 'frontend' } },
        },
      ],
    }));

    const ds = makeInstance('http://jaeger.example.com/jaeger');
    const from = { valueOf: () => 1000 };
    const to = { valueOf: () => 2000 };
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: 'frontend', limit: 5 }],
      range: { from, to } as any,
    } as any);

    const calledUrl = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('jaeger.example.com/jaeger/api/traces');
    expect(calledUrl).toContain('service=frontend');
    expect(calledUrl).toContain('limit=5');

    expect(result.data).toHaveLength(1);
    const frame = result.data[0];
    expect(frame.name).toBe('traces');
    const traceIdField = frame.fields.find((f: any) => f.name === 'traceID');
    expect(traceIdField.values[0]).toBe('trace1');
    const traceNameField = frame.fields.find((f: any) => f.name === 'traceName');
    expect(traceNameField.values[0]).toBe('frontend: HTTP GET /dispatch');
  });

  it('returns empty data when no service is provided', async () => {
    const ds = makeInstance();
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: '' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);
    expect(result.data).toHaveLength(0);
  });

  it('applies template variable interpolation', async () => {
    mockGetTemplateSrv.mockReturnValue({ replace: (s: string) => s.replace('${svc}', 'driver') });
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse({ data: [] }));

    const ds = makeInstance('http://localhost:16686');
    await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: '${svc}' }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);

    const calledUrl = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('service=driver');
  });

  it('skips hidden targets', async () => {
    const ds = makeInstance();
    const result = await ds.query({
      targets: [{ refId: 'A', queryType: 'search', service: 'frontend', hide: true }],
      range: { from: { valueOf: () => 0 }, to: { valueOf: () => 0 } } as any,
    } as any);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(0);
  });
});
