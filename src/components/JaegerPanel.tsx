import React from 'react';
import { PanelProps } from '@grafana/data';
import { JaegerPanelOptions } from 'types';

type Props = PanelProps<JaegerPanelOptions>;

function buildUrl(options: JaegerPanelOptions, replaceVariables: Props['replaceVariables']): string | null {
  const base = replaceVariables(options.jaegerBaseUrl).replace(/\/$/, '');
  const traceId = replaceVariables(options.traceId).trim();
  const traceIdB = replaceVariables(options.traceIdB).trim();
  const service = replaceVariables(options.service).trim();

  const params = new URLSearchParams({ uiEmbed: 'v0' });

  switch (options.mode) {
    case 'trace':
      if (!traceId) {
        return null;
      }
      if (options.hideTimelineMinimap) {
        params.set('uiTimelineHideMinimap', '1');
      }
      if (options.hideTimelineSummary) {
        params.set('uiTimelineHideSummary', '1');
      }
      if (options.collapseTraceHeader) {
        params.set('uiTimelineCollapseTitle', '1');
      }
      return `${base}/trace/${traceId}?${params}`;

    case 'diff':
      if (!traceId || !traceIdB) {
        return null;
      }
      if (options.hideTimelineMinimap) {
        params.set('uiTimelineHideMinimap', '1');
      }
      if (options.hideTimelineSummary) {
        params.set('uiTimelineHideSummary', '1');
      }
      if (options.collapseTraceHeader) {
        params.set('uiTimelineCollapseTitle', '1');
      }
      return `${base}/trace/${traceId}...${traceIdB}?${params}`;

    case 'search':
      // Jaeger auto-submits the search query on load; without a service it errors immediately.
      // Until jaeger-ui suppresses the auto-query in embed mode (Phase 2), require a service.
      if (!service) {
        return null;
      }
      params.set('uiSearchHideGraph', '1');
      params.set('service', service);
      return `${base}/search?${params}`;

    default:
      return null;
  }
}

export const JaegerPanel: React.FC<Props> = ({ options, width, height, replaceVariables }) => {
  const url = buildUrl(options, replaceVariables);

  if (!url) {
    const hint =
      options.mode === 'diff'
        ? 'Enter two Trace IDs in panel options.'
        : options.mode === 'search'
          ? 'Enter a Service name in panel options.'
          : 'Enter a Trace ID in panel options.';
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#aaa',
          fontSize: 14,
        }}
        data-testid="jaeger-panel-hint"
      >
        {hint}
      </div>
    );
  }

  return (
    <iframe
      src={url}
      width={width}
      height={height}
      style={{ border: 'none', display: 'block' }}
      title="Jaeger Trace"
      data-testid="jaeger-panel-iframe"
    />
  );
};
