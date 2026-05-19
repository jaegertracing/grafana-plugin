import React from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { InlineField, InlineFieldRow, Input } from '@grafana/ui';
import { JaegerDataSourceOptions } from '../types';

type Props = DataSourcePluginOptionsEditorProps<JaegerDataSourceOptions>;

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData } = options;

  const onJaegerPublicURLChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, jaegerPublicURL: e.currentTarget.value } });
  };

  return (
    <InlineFieldRow>
      <InlineField
        label="Jaeger UI URL"
        labelWidth={20}
        tooltip="Browser-accessible URL of the Jaeger query service (e.g. http://localhost:16686 or https://grafana.mydomain.com/jaeger). The panel iframe loads Jaeger UI directly from this address."
      >
        <Input
          value={jsonData.jaegerPublicURL ?? ''}
          placeholder="http://localhost:16686"
          width={40}
          onChange={onJaegerPublicURLChange}
          data-testid="jaeger-public-url-input"
        />
      </InlineField>
    </InlineFieldRow>
  );
}
