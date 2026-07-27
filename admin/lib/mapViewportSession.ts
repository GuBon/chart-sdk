import {
  normalizeMapViewport,
  type MapBounds,
  type MapViewport,
  type MapViewportMode,
} from '@chartsdk/chart-options/geo';

export type MapViewportInteraction = 'idle' | 'explore' | 'panZoomEdit' | 'boxZoom';

/**
 * 지도에 현재 보이는 카메라와 저장 대상 영역을 분리한다.
 *
 * - visibleBounds: 단순 탐색을 포함한 현재 화면
 * - draft: 상단 저장에 포함할 영역 초안
 * - checkpoint: 영역 [저장]/[초기화]가 사용하는 로컬 체크포인트
 */
export interface MapViewportSession {
  activePanel: MapViewportMode;
  draft: MapViewport;
  checkpoint: MapViewport;
  visibleBounds: MapBounds | null;
  editing: boolean;
  /** 수동 패널에 막 진입했을 때만 현재 탐색 화면을 영역 저장 후보로 사용한다. */
  captureVisibleOnSave: boolean;
  interaction: MapViewportInteraction;
  /** 명시적인 영역 적용 때만 증가한다. 일반 옵션 재렌더링은 현재 탐색 카메라를 보존한다. */
  revision: number;
}

export type MapViewportSessionAction =
  | { type: 'selectPanel'; mode: MapViewportMode }
  | { type: 'setEditing'; editing: boolean }
  | { type: 'syncVisible'; bounds: MapBounds | null }
  | { type: 'roam'; bounds: MapBounds }
  | { type: 'apply'; viewport: MapViewport }
  | { type: 'boxSelect'; bounds: MapBounds }
  | { type: 'saveCheckpoint'; viewport?: MapViewport }
  | { type: 'resetCheckpoint' }
  | { type: 'saveGlobal'; viewport?: MapViewport }
  | { type: 'restoreGlobal'; viewport: MapViewport };

export function createMapViewportSession(value: unknown): MapViewportSession {
  const viewport = cloneViewport(normalizeMapViewport(value));
  return {
    activePanel: viewport.mode,
    draft: viewport,
    checkpoint: cloneViewport(viewport),
    visibleBounds: viewportBounds(viewport),
    editing: false,
    captureVisibleOnSave: false,
    interaction: 'idle',
    revision: 0,
  };
}

export function mapViewportSessionReducer(
  state: MapViewportSession,
  action: MapViewportSessionAction,
): MapViewportSession {
  switch (action.type) {
    case 'selectPanel':
      return {
        ...state,
        activePanel: action.mode,
        editing: action.mode === 'manual',
        captureVisibleOnSave: action.mode === 'manual' && !state.editing,
        interaction: 'idle',
      };
    case 'setEditing':
      return {
        ...state,
        editing: action.editing,
        captureVisibleOnSave: action.editing ? state.captureVisibleOnSave : false,
        interaction: action.editing ? state.interaction : 'idle',
      };
    case 'syncVisible':
      return {
        ...state,
        visibleBounds: cloneBounds(action.bounds),
        interaction: 'idle',
      };
    case 'roam': {
      const bounds = cloneBounds(action.bounds)!;
      if (!state.editing) {
        return {
          ...state,
          visibleBounds: bounds,
          interaction: 'explore',
        };
      }
      return {
        ...state,
        activePanel: 'manual',
        draft: { mode: 'manual', bounds },
        visibleBounds: bounds,
        captureVisibleOnSave: false,
        interaction: 'panZoomEdit',
      };
    }
    case 'apply': {
      const viewport = cloneViewport(action.viewport);
      return {
        ...state,
        activePanel: viewport.mode,
        draft: viewport,
        editing: viewport.mode === 'manual',
        captureVisibleOnSave: false,
        interaction: 'idle',
        revision: state.revision + 1,
      };
    }
    case 'boxSelect': {
      const bounds = cloneBounds(action.bounds)!;
      return {
        ...state,
        activePanel: 'manual',
        draft: { mode: 'manual', bounds },
        visibleBounds: bounds,
        editing: true,
        captureVisibleOnSave: false,
        interaction: 'boxZoom',
        revision: state.revision + 1,
      };
    }
    case 'saveCheckpoint': {
      const viewport = cloneViewport(action.viewport ?? pendingMapViewport(state));
      return {
        ...state,
        draft: viewport,
        checkpoint: cloneViewport(viewport),
        captureVisibleOnSave: false,
        interaction: 'idle',
      };
    }
    case 'resetCheckpoint': {
      const viewport = cloneViewport(state.checkpoint);
      return {
        ...state,
        activePanel: viewport.mode,
        draft: viewport,
        visibleBounds: viewportBounds(viewport),
        editing: false,
        captureVisibleOnSave: false,
        interaction: 'idle',
        revision: state.revision + 1,
      };
    }
    case 'saveGlobal': {
      const viewport = cloneViewport(action.viewport ?? state.draft);
      return {
        ...state,
        draft: viewport,
        checkpoint: cloneViewport(viewport),
        editing: false,
        captureVisibleOnSave: false,
        interaction: 'idle',
      };
    }
    case 'restoreGlobal': {
      const viewport = cloneViewport(action.viewport);
      return {
        activePanel: viewport.mode,
        draft: viewport,
        checkpoint: cloneViewport(viewport),
        visibleBounds: viewportBounds(viewport),
        editing: false,
        captureVisibleOnSave: false,
        interaction: 'idle',
        revision: state.revision + 1,
      };
    }
  }
}

/**
 * 수동 편집 패널에서는 아직 드래그하지 않았더라도 현재 화면을 영역 저장으로 확정할 수 있다.
 * 일반 탐색 중에는 draft를 그대로 반환하므로 상단 저장에 탐색 카메라가 섞이지 않는다.
 */
export function pendingMapViewport(state: MapViewportSession): MapViewport {
  if (state.captureVisibleOnSave && state.editing && state.activePanel === 'manual' && state.visibleBounds) {
    return { mode: 'manual', bounds: cloneBounds(state.visibleBounds)! };
  }
  return cloneViewport(state.draft);
}

export function mapViewportEquals(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeMapViewport(left);
  const normalizedRight = normalizeMapViewport(right);
  if (normalizedLeft.mode !== normalizedRight.mode) return false;
  if (normalizedLeft.mode === 'regions' && normalizedRight.mode === 'regions') {
    if (normalizedLeft.regionKeys.length !== normalizedRight.regionKeys.length) return false;
    if (normalizedLeft.regionKeys.some((key, index) => key !== normalizedRight.regionKeys[index])) return false;
  }
  const leftBounds = 'bounds' in normalizedLeft ? normalizedLeft.bounds : undefined;
  const rightBounds = 'bounds' in normalizedRight ? normalizedRight.bounds : undefined;
  if (!leftBounds || !rightBounds) return !leftBounds && !rightBounds;
  return (Object.keys(leftBounds) as (keyof MapBounds)[])
    .every((key) => Math.abs(leftBounds[key] - rightBounds[key]) <= 1e-6);
}

export function isCompleteMapViewport(value: unknown): boolean {
  const viewport = normalizeMapViewport(value);
  if (viewport.mode === 'data') return true;
  if (viewport.mode === 'regions') return viewport.regionKeys.length > 0;
  return !!viewport.bounds;
}

function viewportBounds(viewport: MapViewport): MapBounds | null {
  return 'bounds' in viewport ? cloneBounds(viewport.bounds ?? null) : null;
}

function cloneViewport(value: unknown): MapViewport {
  return structuredClone(normalizeMapViewport(value));
}

function cloneBounds(bounds: MapBounds | null | undefined): MapBounds | null {
  return bounds ? { ...bounds } : null;
}
