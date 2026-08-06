package com.chartsdk.datasource;

import com.chartsdk.crypto.DatasourcePasswordCodec;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LegacyDatasourcePasswordMigrationServiceTest {
    @Test
    void validatesExistingCiphertextThenMigratesOnlyLegacyRows() {
        DatasourcePasswordRepository repository = mock(DatasourcePasswordRepository.class);
        DatasourcePasswordCodec codec = new DatasourcePasswordCodec("stable-key");
        StoredDatasourcePassword encrypted = new StoredDatasourcePassword(1L, codec.encrypt("existing"));
        StoredDatasourcePassword legacy = new StoredDatasourcePassword(2L, "legacy-secret");
        when(repository.lockAll()).thenReturn(List.of(encrypted, legacy));
        when(repository.replaceIfUnchanged(org.mockito.ArgumentMatchers.eq(legacy),
                org.mockito.ArgumentMatchers.anyString())).thenReturn(1);
        LegacyDatasourcePasswordMigrationService service =
                new LegacyDatasourcePasswordMigrationService(repository, codec);

        LegacyDatasourcePasswordMigrationService.MigrationResult result = service.migrate();

        assertThat(result).isEqualTo(new LegacyDatasourcePasswordMigrationService.MigrationResult(2, 1, 1, 0));
        ArgumentCaptor<String> replacement = ArgumentCaptor.forClass(String.class);
        verify(repository).replaceIfUnchanged(org.mockito.ArgumentMatchers.eq(legacy), replacement.capture());
        assertThat(codec.isEncrypted(replacement.getValue())).isTrue();
        assertThat(codec.decrypt(replacement.getValue())).isEqualTo("legacy-secret");
    }

    @Test
    void wrongKeyStopsBeforeAnyLegacyRowIsChanged() {
        DatasourcePasswordRepository repository = mock(DatasourcePasswordRepository.class);
        DatasourcePasswordCodec original = new DatasourcePasswordCodec("original-key");
        StoredDatasourcePassword encrypted = new StoredDatasourcePassword(1L, original.encrypt("existing"));
        StoredDatasourcePassword legacy = new StoredDatasourcePassword(2L, "legacy-secret");
        when(repository.lockAll()).thenReturn(List.of(encrypted, legacy));
        LegacyDatasourcePasswordMigrationService service = new LegacyDatasourcePasswordMigrationService(
                repository, new DatasourcePasswordCodec("wrong-key"));

        assertThatThrownBy(service::migrate)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("key mismatch");
        verify(repository, never()).replaceIfUnchanged(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void reportsAConcurrentReplacementAsSkipped() {
        DatasourcePasswordRepository repository = mock(DatasourcePasswordRepository.class);
        DatasourcePasswordCodec codec = new DatasourcePasswordCodec("stable-key");
        StoredDatasourcePassword legacy = new StoredDatasourcePassword(2L, "legacy-secret");
        when(repository.lockAll()).thenReturn(List.of(legacy));
        when(repository.replaceIfUnchanged(org.mockito.ArgumentMatchers.eq(legacy),
                org.mockito.ArgumentMatchers.anyString())).thenReturn(0);
        LegacyDatasourcePasswordMigrationService service =
                new LegacyDatasourcePasswordMigrationService(repository, codec);

        assertThat(service.migrate())
                .isEqualTo(new LegacyDatasourcePasswordMigrationService.MigrationResult(1, 0, 0, 1));
    }

    @Test
    void unsupportedCiphertextVersionStopsBeforeLegacyRowsAreChanged() {
        DatasourcePasswordRepository repository = mock(DatasourcePasswordRepository.class);
        StoredDatasourcePassword future = new StoredDatasourcePassword(1L, "v2:future-ciphertext");
        StoredDatasourcePassword legacy = new StoredDatasourcePassword(2L, "legacy-secret");
        when(repository.lockAll()).thenReturn(List.of(future, legacy));
        LegacyDatasourcePasswordMigrationService service = new LegacyDatasourcePasswordMigrationService(
                repository, new DatasourcePasswordCodec("key"));

        assertThatThrownBy(service::migrate)
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Unsupported");
        verify(repository, never()).replaceIfUnchanged(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyString());
    }
}
