-- 데이터소스의 실제 PostgreSQL 식별자는 변경하지 않고 ChartSDK 표시 이름만 재정의한다.
-- column_name=''은 테이블·View 자체, 그 외 값은 해당 컬럼의 표시 이름을 뜻한다.
CREATE TABLE mc_data_display_name (
    datasource_id BIGINT       NOT NULL,
    schema_name   VARCHAR(128) NOT NULL,
    relation_name VARCHAR(128) NOT NULL,
    column_name   VARCHAR(128) NOT NULL DEFAULT '',
    display_name  VARCHAR(200) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_mc_data_display_name
        PRIMARY KEY (datasource_id, schema_name, relation_name, column_name),
    CONSTRAINT fk_mc_data_display_name_datasource
        FOREIGN KEY (datasource_id) REFERENCES mc_datasource(id) ON DELETE CASCADE,
    CONSTRAINT chk_mc_data_display_name_schema
        CHECK (btrim(schema_name) <> ''),
    CONSTRAINT chk_mc_data_display_name_relation
        CHECK (btrim(relation_name) <> ''),
    CONSTRAINT chk_mc_data_display_name_value
        CHECK (btrim(display_name) <> '')
);

CREATE TRIGGER trg_mc_data_display_name_touch
    BEFORE UPDATE ON mc_data_display_name
    FOR EACH ROW EXECUTE FUNCTION mc_touch_updated_at();
