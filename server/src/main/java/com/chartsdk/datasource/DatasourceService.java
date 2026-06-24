package com.chartsdk.datasource;

import com.chartsdk.crypto.DatasourcePasswordCodec;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class DatasourceService {
    private final JdbcTemplate jdbc;
    private final DatasourcePasswordCodec passwordCodec;

    public DatasourceService(JdbcTemplate jdbc, DatasourcePasswordCodec passwordCodec) {
        this.jdbc = jdbc;
        this.passwordCodec = passwordCodec;
    }

    public DatasourceCredentials credentials(long id) {
        return jdbc.query("""
                SELECT host, port, database_name, db_user, db_password_enc
                  FROM mc_datasource
                 WHERE id=? AND is_active=true
                """, rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "DATASOURCE_NOT_FOUND", "Datasource not found.");
            return new DatasourceCredentials(
                    rs.getString("host"),
                    rs.getInt("port"),
                    rs.getString("database_name"),
                    rs.getString("db_user"),
                    passwordCodec.decrypt(rs.getString("db_password_enc"))
            );
        }, id);
    }
}
