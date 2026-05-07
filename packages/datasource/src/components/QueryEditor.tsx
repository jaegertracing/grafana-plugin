import React, { useCallback, useEffect, useState } from 'react';
import { QueryEditorProps } from '@grafana/data';
import { InlineField, InlineFieldRow, Input, RadioButtonGroup, Select } from '@grafana/ui';
import { JaegerDataSource } from '../datasource/datasource';
import { JaegerDataSourceOptions, JaegerQuery } from '../types';

type Props = QueryEditorProps<JaegerDataSource, JaegerQuery, JaegerDataSourceOptions>;

const queryTypeOptions = [
  { label: 'Search', value: 'search' as const },
  { label: 'Trace ID', value: 'trace' as const },
];

export function QueryEditor({ datasource, query, onChange, onRunQuery }: Props) {
  const [services, setServices] = useState<string[]>([]);
  const [operations, setOperations] = useState<string[]>([]);

  const queryType = query.queryType ?? 'search';

  useEffect(() => {
    datasource.getServices().then(setServices).catch(() => setServices([]));
  }, [datasource]);

  useEffect(() => {
    if (query.service) {
      datasource.getOperations(query.service).then(setOperations).catch(() => setOperations([]));
    } else {
      setOperations([]);
    }
  }, [datasource, query.service]);

  const handleQueryTypeChange = useCallback(
    (value: 'search' | 'trace') => {
      onChange({ ...query, queryType: value });
    },
    [onChange, query]
  );

  return (
    <div>
      <InlineFieldRow>
        <InlineField label="Query type" labelWidth={14}>
          <RadioButtonGroup options={queryTypeOptions} value={queryType} onChange={handleQueryTypeChange} />
        </InlineField>
      </InlineFieldRow>

      {queryType === 'trace' && (
        <InlineFieldRow>
          <InlineField label="Trace ID" labelWidth={14}>
            <Input
              value={query.traceId ?? ''}
              placeholder="e.g. 1234abcd"
              width={40}
              onChange={(e) => onChange({ ...query, traceId: e.currentTarget.value })}
              onBlur={onRunQuery}
            />
          </InlineField>
        </InlineFieldRow>
      )}

      {queryType === 'search' && (
        <>
          <InlineFieldRow>
            <InlineField label="Service" labelWidth={14}>
              <Select
                value={query.service ?? null}
                options={services.map((s) => ({ label: s, value: s }))}
                width={32}
                onChange={(v) => onChange({ ...query, service: v.value ?? '' })}
                isClearable
                placeholder="Select service"
              />
            </InlineField>
            <InlineField label="Operation" labelWidth={14}>
              <Select
                value={query.operation ?? null}
                options={operations.map((o) => ({ label: o, value: o }))}
                width={32}
                onChange={(v) => onChange({ ...query, operation: v.value ?? '' })}
                isClearable
                placeholder="Select operation"
                disabled={!query.service}
              />
            </InlineField>
          </InlineFieldRow>
          <InlineFieldRow>
            <InlineField label="Tags" labelWidth={14} tooltip="key=value pairs separated by spaces">
              <Input
                value={query.tags ?? ''}
                placeholder="http.status_code=200 error=true"
                width={40}
                onChange={(e) => onChange({ ...query, tags: e.currentTarget.value })}
                onBlur={onRunQuery}
              />
            </InlineField>
          </InlineFieldRow>
          <InlineFieldRow>
            <InlineField label="Min duration" labelWidth={14}>
              <Input
                value={query.minDuration ?? ''}
                placeholder="e.g. 1.2s, 100ms"
                width={18}
                onChange={(e) => onChange({ ...query, minDuration: e.currentTarget.value })}
                onBlur={onRunQuery}
              />
            </InlineField>
            <InlineField label="Max duration" labelWidth={14}>
              <Input
                value={query.maxDuration ?? ''}
                placeholder="e.g. 1.2s, 100ms"
                width={18}
                onChange={(e) => onChange({ ...query, maxDuration: e.currentTarget.value })}
                onBlur={onRunQuery}
              />
            </InlineField>
            <InlineField label="Limit" labelWidth={10}>
              <Input
                value={query.limit ?? ''}
                placeholder="20"
                width={8}
                type="number"
                onChange={(e) => onChange({ ...query, limit: Number(e.currentTarget.value) || undefined })}
                onBlur={onRunQuery}
              />
            </InlineField>
          </InlineFieldRow>
        </>
      )}
    </div>
  );
}
