/**
 * 렌더러 공용 제목 레이아웃.
 *
 * 서버는 컨테이너 폭을 모르므로 title.textStyle.width 를 만들지 않는다.
 * SDK와 Admin 미리보기가 실제 렌더 폭을 이 순수 함수에 넘겨 같은 option을 만든다.
 */
export const TITLE_HORIZONTAL_INSET = 32;

type TitleOption = {
  text?: unknown;
  textStyle?: Record<string, unknown>;
  [key: string]: unknown;
};

export function hasChartTitle(option: Record<string, unknown>): boolean {
  const title = option.title as TitleOption | undefined;
  return !!(title && title.text);
}

export function responsiveTitlePatch(containerWidth: number): Record<string, unknown> {
  return {
    title: {
      textStyle: {
        width: Math.max(0, containerWidth - TITLE_HORIZONTAL_INSET),
        overflow: 'truncate',
      },
    },
  };
}

export function withResponsiveTitle(
  option: Record<string, unknown>,
  containerWidth: number,
): Record<string, unknown> {
  if (!hasChartTitle(option)) return option;
  const title = option.title as TitleOption;
  const patch = responsiveTitlePatch(containerWidth) as { title: { textStyle: Record<string, unknown> } };
  return {
    ...option,
    title: {
      ...title,
      textStyle: {
        ...title.textStyle,
        ...patch.title.textStyle,
      },
    },
  };
}
