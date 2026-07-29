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

/**
 * 폭 제한 + 말줄임을 주입해도 되는 제목인지.
 *
 * 세로쓰기 제목은 변환기가 글자마다 줄바꿈을 넣어 보낸다. 여기에 폭 제한을 걸면
 * 모든 줄이 한 글자 폭에 맞춰 잘리므로 제외한다. 최초 setOption 과 resize 패치가
 * 같은 판정을 써야 리사이즈 때 세로 제목이 다시 잘리지 않는다.
 */
export function usesResponsiveTitle(option: Record<string, unknown>): boolean {
  if (!hasChartTitle(option)) return false;
  const title = option.title as TitleOption;
  return !(typeof title.text === 'string' && title.text.includes('\n'));
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
  if (!usesResponsiveTitle(option)) return option;
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
