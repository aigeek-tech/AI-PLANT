import type { Standard, StandardDetail } from './api';

const STANDARD_KIND_BY_CODE: Record<string, string> = {
  DEC: '企业标准',
  GB: '国家标准',
};

const VALUE_TYPE_LABELS: Record<string, string> = {
  string: '文本',
  number: '数值',
  integer: '整数',
  boolean: '布尔值',
  date: '日期',
  enum: '枚举',
  json: '结构化数据',
};

export function localizeStandardSummary(standard: Standard): Standard {
  return standard;
}

export function localizeStandardDetail(standard: StandardDetail): StandardDetail {
  return standard;
}

export function getStandardKindLabel(code: string): string {
  return STANDARD_KIND_BY_CODE[code] ?? '标准体系';
}

export function getValueTypeLabel(valueType: string): string {
  return VALUE_TYPE_LABELS[valueType] ?? '其他';
}
