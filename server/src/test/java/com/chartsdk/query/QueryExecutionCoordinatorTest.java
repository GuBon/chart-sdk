package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class QueryExecutionCoordinatorTest {
    @Test
    void rejectsAfterBoundedWaitAndReleasesPermitsAfterCompletion() throws Exception {
        SimpleMeterRegistry metrics = new SimpleMeterRegistry();
        QueryExecutionCoordinator coordinator = new QueryExecutionCoordinator(metrics, 1, 1, 1, 25);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);

        CompletableFuture<String> first = CompletableFuture.supplyAsync(() -> {
            try {
                return coordinator.execute(7L, AdmissionController.Kind.CHART, () -> {
                    started.countDown();
                    release.await();
                    return "first";
                });
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
        assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();

        assertThatThrownBy(() -> coordinator.execute(
                7L, AdmissionController.Kind.CHART, () -> "second"))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.code()).isEqualTo("QUERY_BUSY"));

        release.countDown();
        assertThat(first.get(1, TimeUnit.SECONDS)).isEqualTo("first");
        assertThat(coordinator.execute(
                7L, AdmissionController.Kind.CHART, () -> "after")).isEqualTo("after");
        assertThat(metrics.counter("chartsdk.customer_query.rejected", "reason", "admission_timeout").count())
                .isEqualTo(1);
        assertThat(metrics.get("chartsdk.customer_query.queued").tag("kind", "chart").gauge().value())
                .isZero();
        assertThat(metrics.get("chartsdk.customer_query.running").tag("kind", "chart").gauge().value())
                .isZero();
    }
}
