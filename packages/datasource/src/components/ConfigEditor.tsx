import React from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { InlineField, InlineFieldRow, InlineSwitch, Input } from '@grafana/ui';
import { JaegerDataSourceOptions } from '../types';

type Props = DataSourcePluginOptionsEditorProps<JaegerDataSourceOptions>;

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData } = options;
  const proxyMode = jsonData.proxyMode ?? false;

  const onProxyModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, proxyMode: e.currentTarget.checked } });
  };

  const onJaegerInternalURLChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, jaegerInternalURL: e.currentTarget.value } });
  };

  return (
    <>
      <InlineFieldRow>
        <InlineField
          label="Proxy mode"
          labelWidth={20}
          tooltip="Route iframe and API calls through the Grafana backend. Required when Jaeger is not directly reachable from the browser (e.g. behind SSO)."
        >
          <InlineSwitch value={proxyMode} onChange={onProxyModeChange} />
        </InlineField>
      </InlineFieldRow>

      {proxyMode && (
        <InlineFieldRow>
          <InlineField
            label="Jaeger internal URL"
            labelWidth={20}
            tooltip="Internal address of the Jaeger query service reachable from the Grafana server (e.g. http://jaeger:16686). Used by the Go backend proxy only."
          >
            <Input
              value={jsonData.jaegerInternalURL ?? ''}
              placeholder="http://jaeger:16686"
              width={40}
              onChange={onJaegerInternalURLChange}
            />
          </InlineField>
        </InlineFieldRow>
      )}
    </>
  );
}
