package com.chartsdk.crypto;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DatasourcePasswordCodecTest {
    @Test
    void roundTripsVersionedCiphertext() {
        DatasourcePasswordCodec codec = new DatasourcePasswordCodec("stable-key");

        String encrypted = codec.encrypt("customer-secret");

        assertThat(codec.isEncrypted(encrypted)).isTrue();
        assertThat(codec.isVersioned(encrypted)).isTrue();
        assertThat(codec.decrypt(encrypted)).isEqualTo("customer-secret");
        assertThat(encrypted).doesNotContain("customer-secret");
    }

    @Test
    void rejectsLegacyAndWrongKeyInTheCryptoLayer() {
        DatasourcePasswordCodec writer = new DatasourcePasswordCodec("key-a");
        DatasourcePasswordCodec reader = new DatasourcePasswordCodec("key-b");

        assertThatThrownBy(() -> writer.decrypt("legacy-plaintext"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> reader.decrypt(writer.encrypt("secret")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("key mismatch");
    }

    @Test
    void recognizesButRejectsAnUnsupportedVersion() {
        DatasourcePasswordCodec codec = new DatasourcePasswordCodec("key");

        assertThat(codec.isVersioned("v2:future-ciphertext")).isTrue();
        assertThat(codec.isEncrypted("v2:future-ciphertext")).isFalse();
        assertThatThrownBy(() -> codec.decrypt("v2:future-ciphertext"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Unsupported");
    }
}
