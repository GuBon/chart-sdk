package com.chartsdk.query;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.temporal.TemporalAccessor;
import java.util.List;

public final class SqlLiterals {
    private SqlLiterals() {
    }

    public static String inline(String sql, List<Object> params) {
        if (params == null || params.isEmpty()) return sql;
        StringBuilder out = new StringBuilder();
        int paramIndex = 0;
        for (int i = 0; i < sql.length(); i++) {
            char ch = sql.charAt(i);
            if (ch == '?' && paramIndex < params.size()) {
                out.append(literal(params.get(paramIndex++)));
            } else {
                out.append(ch);
            }
        }
        return out.toString();
    }

    private static String literal(Object value) {
        if (value == null) return "NULL";
        if (value instanceof Number || value instanceof Boolean) return String.valueOf(value);
        if (value instanceof Date || value instanceof Timestamp || value instanceof TemporalAccessor) {
            return quote(String.valueOf(value));
        }
        return quote(String.valueOf(value));
    }

    private static String quote(String value) {
        return "'" + value.replace("'", "''") + "'";
    }
}
