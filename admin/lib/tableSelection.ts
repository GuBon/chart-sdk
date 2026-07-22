export type TableSelectionTarget =
  | { kind: 'base' }
  | { kind: 'join'; index: number }
  | { kind: 'newJoin' };

export function tableSelectionLabel(target: TableSelectionTarget, joinCount: number): string {
  if (target.kind === 'base') return '원본 테이블 선택 중';
  const index = target.kind === 'join' ? target.index : joinCount;
  return `${index + 1}번째 조인 테이블 선택 중`;
}
