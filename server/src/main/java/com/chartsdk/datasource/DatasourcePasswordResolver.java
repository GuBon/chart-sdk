package com.chartsdk.datasource;

import com.chartsdk.crypto.DatasourcePasswordCodec;
import com.chartsdk.metrics.DatasourcePasswordMetrics;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Applies the runtime policy around the versioned datasource-password codec. */
@Component
public class DatasourcePasswordResolver {
    private final DatasourcePasswordCodec codec;
    private final DatasourcePasswordMetrics metrics;
    private final boolean allowLegacyPlaintext;

    public DatasourcePasswordResolver(
            DatasourcePasswordCodec codec,
            DatasourcePasswordMetrics metrics,
            @Value("${chartsdk.datasource.password.allow-legacy-plaintext:true}") boolean allowLegacyPlaintext
    ) {
        this.codec = codec;
        this.metrics = metrics;
        this.allowLegacyPlaintext = allowLegacyPlaintext;
    }

    public String encrypt(String plaintext) {
        return codec.encrypt(plaintext);
    }

    public String resolve(String stored) {
        if (stored == null || stored.isEmpty() || codec.isVersioned(stored)) {
            return codec.decrypt(stored);
        }
        metrics.legacyRead();
        if (!allowLegacyPlaintext) {
            throw new IllegalStateException(
                    "Legacy plaintext datasource password is disabled; run the password migration first");
        }
        return stored;
    }
}
