package com.chartsdk.datasource;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
class DatasourcePasswordRepository {
    private final JdbcTemplate jdbc;

    DatasourcePasswordRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    List<StoredDatasourcePassword> lockAll() {
        return jdbc.query("""
                SELECT id, db_password_enc
                  FROM mc_datasource
                 ORDER BY id
                   FOR UPDATE
                """, (rs, rowNum) -> new StoredDatasourcePassword(
                rs.getLong("id"), rs.getString("db_password_enc")));
    }

    int replaceIfUnchanged(StoredDatasourcePassword password, String encrypted) {
        return jdbc.update("""
                UPDATE mc_datasource
                   SET db_password_enc=?
                 WHERE id=?
                   AND db_password_enc=?
                   AND db_password_enc NOT LIKE 'v1:%'
                """, encrypted, password.datasourceId(), password.value());
    }

    int countLegacy() {
        Integer count = jdbc.queryForObject("""
                SELECT count(*)
                  FROM mc_datasource
                 WHERE db_password_enc NOT LIKE 'v1:%'
                """, Integer.class);
        return count == null ? 0 : count;
    }
}
