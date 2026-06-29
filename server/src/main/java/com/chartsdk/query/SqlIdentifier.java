package com.chartsdk.query;

public final class SqlIdentifier {
    private SqlIdentifier() {
    }

    public static String quote(String ident) {
        return "\"" + ident.replace("\"", "\"\"") + "\"";
    }
}
