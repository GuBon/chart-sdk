package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.sql.Connection;
import java.sql.Date;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLTimeoutException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Executes final chart aggregation over the bounded rows held by the L1 sample cache. */
@Component
public class CachedSampleExecutor {
    private static final int INSERT_BATCH_SIZE = 1_000;
    private final QueryTimeoutPolicy timeouts;

    public CachedSampleExecutor() {
        this(QueryTimeoutPolicy.defaults());
    }

    @Autowired
    public CachedSampleExecutor(QueryTimeoutPolicy timeouts) {
        this.timeouts = timeouts;
    }

    public QueryRows execute(QueryRows sample, BuilderSqlBuilder.Sql aggregate) {
        if (sample == null || aggregate == null) {
            throw new IllegalArgumentException("sample and aggregate are required");
        }
        try (Connection connection = DriverManager.getConnection("jdbc:duckdb:")) {
            List<String> types = createSampleTable(connection, sample);
            insertRows(connection, sample, types);
            long start = System.nanoTime();
            try (PreparedStatement statement = connection.prepareStatement(aggregate.text())) {
                statement.setQueryTimeout(timeouts.seconds(AdmissionController.Kind.SAMPLE));
                statement.setMaxRows(QueryExecutor.UNBOUNDED_CHART_ROWS);
                for (int i = 0; i < aggregate.params().size(); i++) {
                    statement.setObject(i + 1, aggregate.params().get(i));
                }
                try (ResultSet resultSet = statement.executeQuery()) {
                    return QueryRows.from(resultSet, start, QueryExecutor.UNBOUNDED_CHART_ROWS);
                }
            }
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Sample query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "SAMPLE_AGGREGATION_ERROR", firstLine(e.getMessage()));
        }
    }

    private List<String> createSampleTable(Connection connection, QueryRows sample) throws Exception {
        List<String> types = new ArrayList<>();
        List<String> definitions = new ArrayList<>();
        for (int i = 0; i < sample.columns().size(); i++) {
            Map<String, Object> column = sample.columns().get(i);
            String name = String.valueOf(column.get("name"));
            String sourceType = String.valueOf(column.get("type"));
            String type = duckType(sourceType, sample.rows(), i);
            types.add(type);
            definitions.add(SqlIdentifier.quote(name) + " " + type);
        }
        try (Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(timeouts.seconds(AdmissionController.Kind.SAMPLE));
            statement.execute("CREATE TEMP TABLE " + SqlIdentifier.quote(CachedSampleSqlBuilder.SAMPLE_TABLE)
                    + " (" + String.join(", ", definitions) + ")");
        }
        return types;
    }

    private void insertRows(Connection connection, QueryRows sample, List<String> types) throws Exception {
        if (sample.rows().isEmpty()) return;
        String placeholders = String.join(", ", java.util.Collections.nCopies(types.size(), "?"));
        String sql = "INSERT INTO " + SqlIdentifier.quote(CachedSampleSqlBuilder.SAMPLE_TABLE)
                + " VALUES (" + placeholders + ")";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setQueryTimeout(timeouts.seconds(AdmissionController.Kind.SAMPLE));
            int pending = 0;
            for (List<Object> row : sample.rows()) {
                if (row.size() != types.size()) {
                    throw new IllegalArgumentException("Cached sample row width does not match its schema.");
                }
                for (int i = 0; i < types.size(); i++) {
                    statement.setObject(i + 1, convert(row.get(i), types.get(i)));
                }
                statement.addBatch();
                if (++pending == INSERT_BATCH_SIZE) {
                    statement.executeBatch();
                    pending = 0;
                }
            }
            if (pending > 0) statement.executeBatch();
        }
    }

    private static String duckType(String sourceType, List<List<Object>> rows, int column) {
        String type = sourceType == null ? "" : sourceType.toLowerCase(Locale.ROOT);
        if (type.contains("bool")) return "BOOLEAN";
        if (type.equals("int2") || type.contains("smallint")) return "SMALLINT";
        if (type.equals("int4") || type.equals("integer") || type.equals("serial")) return "INTEGER";
        if (type.equals("int8") || type.contains("bigint") || type.equals("bigserial")) return "BIGINT";
        if (type.startsWith("numeric") || type.startsWith("decimal") || type.equals("hugeint")) {
            return decimalType(rows, column);
        }
        if (type.equals("real") || type.equals("float4")) return "REAL";
        if (type.contains("double") || type.equals("float8") || type.startsWith("float")) return "DOUBLE";
        if (type.startsWith("date")) return "DATE";
        if (type.contains("timestamp") && (type.contains("tz") || type.contains("time zone"))) return "TIMESTAMPTZ";
        if (type.contains("timestamp")) return "TIMESTAMP";
        if (type.contains("bytea") || type.contains("blob") || type.contains("binary")) return "BLOB";
        return "VARCHAR";
    }

    private static String decimalType(List<List<Object>> rows, int column) {
        int scale = 0;
        int integerDigits = 1;
        for (List<Object> row : rows) {
            if (column >= row.size() || row.get(column) == null) continue;
            try {
                BigDecimal value = row.get(column) instanceof BigDecimal decimal
                        ? decimal : new BigDecimal(String.valueOf(row.get(column)));
                scale = Math.max(scale, Math.max(0, value.scale()));
                integerDigits = Math.max(integerDigits, Math.max(1, value.precision() - value.scale()));
            } catch (NumberFormatException ignored) {
                return "DOUBLE";
            }
        }
        if (scale + integerDigits > 38) return "DOUBLE";
        return "DECIMAL(" + Math.max(1, scale + integerDigits) + "," + scale + ")";
    }

    private static Object convert(Object value, String targetType) {
        if (value == null) return null;
        try {
            if (targetType.equals("VARCHAR")) return String.valueOf(value);
            if (targetType.equals("BOOLEAN")) {
                return value instanceof Boolean bool ? bool : Boolean.parseBoolean(String.valueOf(value));
            }
            if (targetType.equals("SMALLINT")) return value instanceof Number n ? n.shortValue() : Short.valueOf(String.valueOf(value));
            if (targetType.equals("INTEGER")) return value instanceof Number n ? n.intValue() : Integer.valueOf(String.valueOf(value));
            if (targetType.equals("BIGINT")) {
                if (value instanceof BigInteger integer) return integer.longValueExact();
                return value instanceof Number n ? n.longValue() : Long.valueOf(String.valueOf(value));
            }
            if (targetType.startsWith("DECIMAL")) {
                return value instanceof BigDecimal decimal ? decimal : new BigDecimal(String.valueOf(value));
            }
            if (targetType.equals("REAL")) return value instanceof Number n ? n.floatValue() : Float.valueOf(String.valueOf(value));
            if (targetType.equals("DOUBLE")) return value instanceof Number n ? n.doubleValue() : Double.valueOf(String.valueOf(value));
            if (targetType.equals("DATE")) return date(value);
            if (targetType.equals("TIMESTAMP")) return timestamp(value);
            if (targetType.equals("TIMESTAMPTZ")) return timestampWithZone(value);
            if (targetType.equals("BLOB") && value instanceof byte[] bytes) return bytes;
            return value;
        } catch (RuntimeException conversionFailure) {
            throw new IllegalArgumentException("Cannot convert cached value to " + targetType + ": " + value,
                    conversionFailure);
        }
    }

    private static LocalDate date(Object value) {
        if (value instanceof LocalDate date) return date;
        if (value instanceof Date date) return date.toLocalDate();
        if (value instanceof Number number) return Instant.ofEpochMilli(number.longValue()).atZone(ZoneOffset.UTC).toLocalDate();
        return LocalDate.parse(String.valueOf(value).substring(0, 10));
    }

    private static LocalDateTime timestamp(Object value) {
        if (value instanceof LocalDateTime dateTime) return dateTime;
        if (value instanceof Timestamp timestamp) return timestamp.toLocalDateTime();
        if (value instanceof OffsetDateTime offset) return offset.toLocalDateTime();
        if (value instanceof Number number) return LocalDateTime.ofInstant(
                Instant.ofEpochMilli(number.longValue()), ZoneOffset.UTC);
        String raw = String.valueOf(value).replace(' ', 'T');
        try {
            return LocalDateTime.parse(raw);
        } catch (RuntimeException ignored) {
            return OffsetDateTime.parse(raw).toLocalDateTime();
        }
    }

    private static OffsetDateTime timestampWithZone(Object value) {
        if (value instanceof OffsetDateTime offset) return offset;
        if (value instanceof Timestamp timestamp) return timestamp.toInstant().atOffset(ZoneOffset.UTC);
        if (value instanceof Instant instant) return instant.atOffset(ZoneOffset.UTC);
        if (value instanceof Number number) return Instant.ofEpochMilli(number.longValue()).atOffset(ZoneOffset.UTC);
        String raw = String.valueOf(value).replace(' ', 'T');
        try {
            return OffsetDateTime.parse(raw);
        } catch (RuntimeException ignored) {
            return LocalDateTime.parse(raw).atOffset(ZoneOffset.UTC);
        }
    }

    private static String firstLine(String message) {
        return message == null ? "Cached sample aggregation failed." : message.split("\\R", 2)[0];
    }
}
