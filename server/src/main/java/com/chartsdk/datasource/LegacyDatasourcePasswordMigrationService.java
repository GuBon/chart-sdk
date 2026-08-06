package com.chartsdk.datasource;

import com.chartsdk.crypto.DatasourcePasswordCodec;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;

/** One-shot, key-aware migration from unversioned plaintext to the existing v1 AES-GCM format. */
@Service
public class LegacyDatasourcePasswordMigrationService {
    private final DatasourcePasswordRepository passwords;
    private final DatasourcePasswordCodec codec;

    public LegacyDatasourcePasswordMigrationService(
            DatasourcePasswordRepository passwords,
            DatasourcePasswordCodec codec
    ) {
        this.passwords = passwords;
        this.codec = codec;
    }

    @Transactional
    public MigrationResult migrate() {
        List<StoredDatasourcePassword> stored = passwords.lockAll();

        // Validate the configured key before changing any legacy row.
        stored.stream()
                .filter(password -> codec.isVersioned(password.value()))
                .forEach(password -> codec.decrypt(password.value()));

        int encrypted = 0;
        int migrated = 0;
        int skipped = 0;
        for (StoredDatasourcePassword password : stored) {
            if (codec.isVersioned(password.value())) {
                encrypted++;
                continue;
            }
            String replacement = codec.encrypt(password.value());
            if (!Objects.equals(password.value(), codec.decrypt(replacement))) {
                throw new IllegalStateException("Datasource password encryption round-trip failed");
            }
            int updated = passwords.replaceIfUnchanged(password, replacement);
            if (updated == 1) migrated++;
            else skipped++;
        }
        return new MigrationResult(stored.size(), encrypted, migrated, skipped);
    }

    public int countLegacy() {
        return passwords.countLegacy();
    }

    public record MigrationResult(int total, int alreadyEncrypted, int migrated, int skipped) {
    }
}
