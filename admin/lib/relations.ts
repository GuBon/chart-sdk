import type { RelationType, SchemaTable } from '@/lib/api';

const LABELS: Record<RelationType, string> = {
  TABLE: 'TABLE',
  VIEW: 'View',
  MATERIALIZED_VIEW: 'Materialized View',
};

export function relationTypeLabel(type: RelationType): string {
  return LABELS[type];
}

export function relationBadgeLabel(relation: Pick<SchemaTable, 'relationType' | 'populated'>): string {
  const label = relationTypeLabel(relation.relationType);
  return isRelationSelectable(relation) ? label : `${label} · 갱신 필요`;
}

export function isRelationSelectable(relation: Pick<SchemaTable, 'relationType' | 'populated'>): boolean {
  return relation.relationType !== 'MATERIALIZED_VIEW' || relation.populated !== false;
}
