import React from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { InlineField, Input } from '@grafana/ui';
import { JaegerDataSourceOptions } from '../types';

type Props = DataSourcePluginOptionsEditorProps<JaegerDataSourceOptions>;

export function ConfigEditor({ options, onOptionsChange }: Props) {
  return (
    <InlineField label="Jaeger URL" labelWidth={16} tooltip="Base URL of the Jaeger query service">
      <Input
        value={options.jsonData.jaegerUrl ?? ''}
        placeholder="http://localhost:16686"
        width={40}
        onChange={(e) =>
          onOptionsChange({
            ...options,
            jsonData: { ...options.jsonData, jaegerUrl: e.currentTarget.value },
          })
        }
      />
    </InlineField>
  );
}
