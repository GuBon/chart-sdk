package com.chartsdk.datasource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** Runs the opt-in migration before readiness and enforces fail-closed production policy. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class DatasourcePasswordStartupGuard implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(DatasourcePasswordStartupGuard.class);

    private final LegacyDatasourcePasswordMigrationService migration;
    private final boolean allowLegacyPlaintext;
    private final boolean migrateOnStartup;

    public DatasourcePasswordStartupGuard(
            LegacyDatasourcePasswordMigrationService migration,
            @Value("${chartsdk.datasource.password.allow-legacy-plaintext:true}") boolean allowLegacyPlaintext,
            @Value("${chartsdk.datasource.password.migrate-legacy-on-startup:false}") boolean migrateOnStartup
    ) {
        this.migration = migration;
        this.allowLegacyPlaintext = allowLegacyPlaintext;
        this.migrateOnStartup = migrateOnStartup;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (migrateOnStartup) {
            LegacyDatasourcePasswordMigrationService.MigrationResult result = migration.migrate();
            log.info("Datasource password migration completed: total={}, encrypted={}, migrated={}, skipped={}",
                    result.total(), result.alreadyEncrypted(), result.migrated(), result.skipped());
        }

        int legacyCount = migration.countLegacy();
        if (legacyCount == 0) return;
        if (!allowLegacyPlaintext) {
            throw new IllegalStateException(
                    "Legacy plaintext datasource passwords remain while fallback is disabled: count=" + legacyCount);
        }
        log.warn("Legacy plaintext datasource passwords remain enabled temporarily: count={}", legacyCount);
    }
}
