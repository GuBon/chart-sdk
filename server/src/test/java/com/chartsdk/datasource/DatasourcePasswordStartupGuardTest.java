package com.chartsdk.datasource;

import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DatasourcePasswordStartupGuardTest {
    @Test
    void strictModeFailsStartupWhenLegacyRowsRemain() {
        LegacyDatasourcePasswordMigrationService migration = mock(LegacyDatasourcePasswordMigrationService.class);
        when(migration.countLegacy()).thenReturn(2);
        DatasourcePasswordStartupGuard guard = new DatasourcePasswordStartupGuard(migration, false, false);

        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("count=2");
    }

    @Test
    void optInMigrationRunsBeforeStrictValidation() {
        LegacyDatasourcePasswordMigrationService migration = mock(LegacyDatasourcePasswordMigrationService.class);
        when(migration.migrate()).thenReturn(
                new LegacyDatasourcePasswordMigrationService.MigrationResult(5, 3, 2, 0));
        when(migration.countLegacy()).thenReturn(0);
        DatasourcePasswordStartupGuard guard = new DatasourcePasswordStartupGuard(migration, false, true);

        guard.run(new DefaultApplicationArguments());

        verify(migration).migrate();
        verify(migration).countLegacy();
    }
}
