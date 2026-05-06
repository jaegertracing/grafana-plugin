import React from 'react';
import { PanelProps } from '@grafana/data';
import { JaegerPanelOptions } from 'types';

type Props = PanelProps<JaegerPanelOptions>;

function buildUrl(options: JaegerPanelOptions): string | null {
  const base = options.jaegerBaseUrl.replace(/\/$/, '');
  const embed = 'uiEmbed=v0';

  switch (options.mode) {
    case 'trace':
      if (!options.traceId) {
        return null;
      }
      return `${base}/trace/${options.traceId}?${embed}`;
    case 'diff':
      if (!options.traceId || !options.traceIdB) {
        return null;
      }
      return `${base}/trace/${options.traceId}...${options.traceIdB}?${embed}`;
    case 'search':
      return `${base}/search?${embed}&uiSearchHideGraph=1`;
    default:
      return null;
  }
}

export const SimplePanel: React.FC<Props> = ({ options, width, height }) => {
  const url = buildUrl(options);

  if (!url) {
    const hint =
      options.mode === 'diff'
        ? 'Enter two Trace IDs in panel options.'
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
    />
  );
};
