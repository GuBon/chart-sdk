package com.chartsdk.web;

import org.springframework.http.HttpStatus;

import java.util.Map;

public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;
    private final Map<String, Object> fields;

    public ApiException(HttpStatus status, String code, String message) {
        this(status, code, message, null, null);
    }

    public ApiException(HttpStatus status, String code, String message, Map<String, Object> fields) {
        this(status, code, message, fields, null);
    }

    /**
     * 내부 원인(업스트림 DB·페더레이션 예외 등)을 함께 담되, {@code message}(사용자 노출)와 분리한다.
     * {@code cause}는 로그 전용이며 응답 envelope 에는 절대 실리지 않는다 — 원문(스키마·호스트·SQLSTATE
     * 상세)이 클라이언트로 새는 것을 구조적으로 차단한다.
     */
    public ApiException(HttpStatus status, String code, String message, Throwable cause) {
        this(status, code, message, null, cause);
    }

    public ApiException(HttpStatus status, String code, String message,
                        Map<String, Object> fields, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.code = code;
        this.fields = fields == null ? Map.of() : Map.copyOf(fields);
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public Map<String, Object> fields() {
        return fields;
    }
}
