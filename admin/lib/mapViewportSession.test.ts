import { describe, expect, it } from 'vitest';
import {
  createMapViewportSession,
  mapViewportEquals,
  mapViewportSessionReducer,
  pendingMapViewport,
} from './mapViewportSession';

const SEOUL = { west: 126.7, east: 127.2, south: 37.3, north: 37.8 };
const BUSAN = { west: 128.8, east: 129.3, south: 34.9, north: 35.4 };

describe('mapViewportSession', () => {
  it('keeps ordinary roam as transient exploration', () => {
    const initial = createMapViewportSession({ mode: 'data' });
    const roamed = mapViewportSessionReducer(initial, { type: 'roam', bounds: SEOUL });

    expect(roamed.activePanel).toBe('data');
    expect(roamed.draft).toEqual({ mode: 'data' });
    expect(roamed.visibleBounds).toEqual(SEOUL);
    expect(roamed.interaction).toBe('explore');
  });

  it('records roam only after manual editing is explicitly selected', () => {
    const initial = createMapViewportSession({ mode: 'data' });
    const editing = mapViewportSessionReducer(initial, { type: 'selectPanel', mode: 'manual' });
    const roamed = mapViewportSessionReducer(editing, { type: 'roam', bounds: SEOUL });

    expect(roamed.activePanel).toBe('manual');
    expect(roamed.draft).toEqual({ mode: 'manual', bounds: SEOUL });
    expect(roamed.checkpoint).toEqual({ mode: 'data' });
  });

  it('uses the visible camera only when a manual checkpoint is explicitly saved', () => {
    const explored = mapViewportSessionReducer(
      createMapViewportSession({ mode: 'data' }),
      { type: 'roam', bounds: SEOUL },
    );
    expect(pendingMapViewport(explored)).toEqual({ mode: 'data' });

    const editing = mapViewportSessionReducer(explored, { type: 'selectPanel', mode: 'manual' });
    expect(pendingMapViewport(editing)).toEqual({ mode: 'manual', bounds: SEOUL });
  });

  it('restores the local checkpoint separately from the global viewport', () => {
    const global = createMapViewportSession({ mode: 'manual', bounds: SEOUL });
    const selected = mapViewportSessionReducer(global, { type: 'boxSelect', bounds: BUSAN });
    const localSaved = mapViewportSessionReducer(selected, { type: 'saveCheckpoint' });
    expect(mapViewportEquals(pendingMapViewport(localSaved), localSaved.checkpoint)).toBe(true);
    const moved = mapViewportSessionReducer(localSaved, { type: 'roam', bounds: SEOUL });
    const localReset = mapViewportSessionReducer(moved, { type: 'resetCheckpoint' });

    expect(localReset.draft).toEqual({ mode: 'manual', bounds: BUSAN });

    const globalReset = mapViewportSessionReducer(localReset, {
      type: 'restoreGlobal',
      viewport: { mode: 'manual', bounds: SEOUL },
    });
    expect(globalReset.draft).toEqual({ mode: 'manual', bounds: SEOUL });
    expect(globalReset.checkpoint).toEqual({ mode: 'manual', bounds: SEOUL });
  });

  it('treats normalized viewports as equal', () => {
    expect(mapViewportEquals(
      { mode: 'manual', bounds: SEOUL },
      { mode: 'manual', bounds: { ...SEOUL } },
    )).toBe(true);
  });
});
