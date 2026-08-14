-- ============================================
-- V12__index_tuning.sql (2026-08-14) — 실제 쿼리 접근 경로에 맞춘 인덱스 정리
--
-- 원칙: 인덱스는 "돌고 있는 쿼리"가 쓰는 것만 둔다. 쓰이지 않는 인덱스는 조회를 돕지 않으면서
--      모든 INSERT/UPDATE/DELETE 에 쓰기 비용과 VACUUM 부담만 더한다.
--
-- ① mc_sample_row_cache.datasource_ids — GIN 추가
--    SampleRowCacheService.invalidateDatasource 의 `datasource_ids @> ?::jsonb` 가 인덱스 없이
--    전체 스캔이었다. jsonb 컨테인먼트는 GIN 이라야 걸린다. 같은 쿼리의 OR 반대편
--    (primary_datasource_id=?) 도 인덱스가 있어야 BitmapOr 로 합쳐지므로 ③에서 함께 보장한다.
--    연산자가 @> 하나뿐이므로 기본 jsonb_ops 대신 더 작고 빠른 jsonb_path_ops 를 쓴다.
--
-- ② mc_sample_row_cache.created_at — 추가
--    SampleRowCacheService.enforceQuotas 의 하드 TTL 스윕(`created_at < now() - ...`)이
--    쿼터 집행마다 전체 스캔이었다.
--
-- ③ LRU 인덱스 2개 → primary_datasource_id 단일 인덱스로 교체
--    두 인덱스는 쿼터 집행 CTE 의 윈도우 정렬을 노렸지만 실제로는 쓰이지 못한다.
--    윈도우가 요구하는 순서는 (last_accessed_at DESC, fingerprint ASC) 인데 btree 는 정방향
--    (ASC, ASC) 또는 역방향 (DESC, DESC) 만 낼 수 있어 혼합 방향을 만들지 못한다.
--    방향을 맞춘 인덱스를 새로 만드는 대신 두는 이유: 해당 CTE 는 WHERE 가 없어 어차피 테이블
--    전체를 읽고 payload_bytes 를 힙에서 가져와야 한다 — 정렬을 인덱스로 옮겨도 랜덤 I/O 로
--    바뀔 뿐이고, 이 테이블은 payload 쿼터(chartsdk.sampling-cache.max-*-bytes)로 크기가 묶여
--    있다. 남기는 건 실제 조회 조건인 primary_datasource_id 동등 비교뿐이다.
--
-- ④ idx_mc_chart_refresh_lease_expiry — 제거
--    expires_at 은 tryAcquire 의 ON CONFLICT DO UPDATE ... WHERE 절에서만 쓰이는데, 이는 PK 로
--    이미 특정된 행에 대한 조건이라 인덱스를 타지 않는다. 만료 리스를 조회·삭제하는 경로도 없다.
--    이 테이블은 chart_id 가 PK 이고 mc_chart 삭제에 CASCADE 되므로 차트당 1행으로 묶여 있어
--    스윕 자체가 불필요하다.
--    ※ mc_sample_cache_build_lease 쪽 idx_..._expiry 는 존치한다. fingerprint 단위라 행이
--      무한히 늘 수 있고, 빌드 중 프로세스가 죽으면 고아 행이 영구 잔존한다. 이번 변경에서
--      SampleCacheBuildLeaseRepository.tryAcquire 가 만료 행을 기회적으로 정리하도록 했고
--      그 DELETE 가 이 인덱스를 사용한다.
-- ============================================

CREATE INDEX idx_mc_sample_row_cache_ds_ids
    ON mc_sample_row_cache USING gin (datasource_ids jsonb_path_ops);

CREATE INDEX idx_mc_sample_row_cache_created_at
    ON mc_sample_row_cache(created_at);

CREATE INDEX idx_mc_sample_row_cache_datasource
    ON mc_sample_row_cache(primary_datasource_id);

DROP INDEX IF EXISTS idx_mc_sample_row_cache_lru;
DROP INDEX IF EXISTS idx_mc_sample_row_cache_datasource_lru;

DROP INDEX IF EXISTS idx_mc_chart_refresh_lease_expiry;
