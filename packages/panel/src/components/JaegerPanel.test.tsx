import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { FieldType, LoadingState, toDataFrame } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { JaegerPanel } from './JaegerPanel';
import { JaegerPanelOptions } from '../types';

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: jest.fn(),
}));

const mockGetDataSourceSrv = getDataSourceSrv as jest.Mock;

const baseOptions: JaegerPanelOptions = {
  jaegerBaseUrl: 'http://jaeger:16686',
  mode: 'trace',
  traceId: '',
  traceIdB: '',
  service: '',
  hideTimelineMinimap: false,
  hideTimelineSummary: false,
  collapseTraceHeader: false,
};

const baseProps = {
  options: baseOptions,
  width: 800,
  height: 600,
  replaceVariables: (v: string) => v,
  data: { series: [], state: LoadingState.Done, timeRange: {} as any },
  timeRange: {} as any,
  timeZone: 'browser',
  transparent: false,
  title: '',
  id: 1,
  onChangeTimeRange: () => {},
  onOptionsChange: () => {},
  onFieldConfigChange: () => {},
  renderCounter: 0,
  fieldConfig: { defaults: {}, overrides: [] },
  eventBus: { subscribe: () => ({ unsubscribe: () => {} }) } as any,
};

beforeEach(() => {
  mockGetDataSourceSrv.mockReturnValue({
    get: jest.fn().mockResolvedValue({ instanceSettings: { jsonData: { proxyMode: false } } }),
  });
});

describe('JaegerPanel — DataFrame-driven path', () => {
  it('renders iframe from single-row traceID frame, ignoring panel traceId option', () => {
    const frame = toDataFrame({
      name: 'abc123',
      fields: [{ name: 'traceID', type: FieldType.string, values: ['abc123'] }],
    });
    render(<JaegerPanel {...baseProps} data={{ series: [frame], state: LoadingState.Done, timeRange: {} as any }} />);
    const iframe = screen.getByTestId('jaeger-panel-iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('/trace/abc123');
    expect(iframe.src).toContain('uiEmbed=v0');
  });

  it('falls back to panel-options path when frame has multiple rows', () => {
    const frame = toDataFrame({
      name: 'traces',
      fields: [
        { name: 'traceID', type: FieldType.string, values: ['aaa', 'bbb'] },
        { name: 'spanCount', type: FieldType.number, values: [3, 5] },
      ],
    });
    // panel options has no traceId → should show hint
    render(<JaegerPanel {...baseProps} data={{ series: [frame], state: LoadingState.Done, timeRange: {} as any }} />);
    expect(screen.getByTestId('jaeger-panel-hint')).toBeInTheDocument();
  });

  it('falls back to panel-options path when no frames are present', () => {
    const opts = { ...baseOptions, traceId: 'deadbeef' };
    render(<JaegerPanel {...baseProps} options={opts} />);
    const iframe = screen.getByTestId('jaeger-panel-iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('/trace/deadbeef');
  });

  it('applies embed flag options when rendering from DataFrame', () => {
    const opts = { ...baseOptions, hideTimelineMinimap: true, collapseTraceHeader: true };
    const frame = toDataFrame({
      name: 'xyz',
      fields: [{ name: 'traceID', type: FieldType.string, values: ['xyz'] }],
    });
    render(
      <JaegerPanel
        {...baseProps}
        options={opts}
        data={{ series: [frame], state: LoadingState.Done, timeRange: {} as any }}
      />
    );
    const iframe = screen.getByTestId('jaeger-panel-iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('uiTimelineHideMinimap=1');
    expect(iframe.src).toContain('uiTimelineCollapseTitle=1');
  });
});

describe('JaegerPanel — proxy mode base URL', () => {
  const dsUid = 'test-uid-123';
  const dataWithTarget = {
    series: [],
    state: LoadingState.Done,
    timeRange: {} as any,
    request: { targets: [{ datasource: { uid: dsUid } }] } as any,
  };

  it('uses proxy base URL when datasource has proxyMode=true', async () => {
    mockGetDataSourceSrv.mockReturnValue({
      get: jest.fn().mockResolvedValue({ instanceSettings: { jsonData: { proxyMode: true } } }),
    });

    const opts = { ...baseOptions, traceId: 'abc' };
    await act(async () => {
      render(<JaegerPanel {...baseProps} options={opts} data={dataWithTarget} />);
    });

    const iframe = screen.getByTestId('jaeger-panel-iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain(`/api/datasources/uid/${dsUid}/resources`);
    expect(iframe.src).toContain('/trace/abc');
  });

  it('falls back to jaegerBaseUrl when datasource has proxyMode=false', async () => {
    mockGetDataSourceSrv.mockReturnValue({
      get: jest.fn().mockResolvedValue({ instanceSettings: { jsonData: { proxyMode: false } } }),
    });

    const opts = { ...baseOptions, traceId: 'def' };
    await act(async () => {
      render(<JaegerPanel {...baseProps} options={opts} data={dataWithTarget} />);
    });

    const iframe = screen.getByTestId('jaeger-panel-iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('http://jaeger:16686');
    expect(iframe.src).toContain('/trace/def');
    expect(iframe.src).not.toContain('/api/datasources');
  });

  it('falls back to jaegerBaseUrl when getDataSourceSrv rejects', async () => {
    mockGetDataSourceSrv.mockReturnValue({
      get: jest.fn().mockRejectedValue(new Error('not found')),
    });

    const opts = { ...baseOptions, traceId: 'ghi' };
    await act(async () => {
      render(<JaegerPanel {...baseProps} options={opts} data={dataWithTarget} />);
    });

    const iframe = screen.getByTestId('jaeger-panel-iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('http://jaeger:16686');
    expect(iframe.src).toContain('/trace/ghi');
  });
});
