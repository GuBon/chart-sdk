package com.chartsdk.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 오류 응답의 단일 계약(envelope) 생성기. {@code {error:{code,message,fields?,requestId?}}} 형태를 강제한다.
 *
 * <p>불변식(설계 §2): 모든 4xx는 구체적 {@code code} + 사용자 친화 {@code message}를 갖는다. {@code 500}은
 * 오직 예상 못한 서버 버그일 때만 나오며 항상 {@code requestId}를 동반한다. 클라이언트가 유발할 수 있는
 * 것(타입 불일치·없는 라우트·잘못된 메서드 등)은 절대 500이 아니다.
 *
 * <p>{@link ResponseEntityExceptionHandler}를 상속해 스프링 MVC 표준 예외 부류 전체를 올바른 상태코드로
 * 받고(화이트리스트 아님), body 포맷만 이 envelope로 통일한다.
 */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    /** 도메인 예외(Tier 2) — 서비스가 의도적으로 던진 상태/code/message를 그대로 통과시킨다. */
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> handle(ApiException e) {
        return ResponseEntity.status(e.status()).body(envelope(e.code(), e.getMessage(), null));
    }

    /** PostgreSQL SQLSTATE — unique_violation. 표준 JDBC 코드라 드라이버 클래스 import 없이 접근한다. */
    private static final String SQLSTATE_UNIQUE_VIOLATION = "23505";

    /**
     * DB 제약 위반(백스톱). 경쟁 조건이 있는 유일성 등은 앱에서 완전히 사전검증하기 어려워 DB 제약이 최종
     * 방어선이다(설계 §3, M1 이름 중복). PostgreSQL 드라이버가 {@code runtimeOnly}라 제약명을 정확히 주는
     * {@code PSQLException.getConstraint()}는 컴파일 타임에 쓸 수 없으므로, 표준 {@link SQLException#getSQLState()}로
     * "unique 위반"임을 먼저 확정한 뒤(23505) 위반 관계·컬럼을 메시지로 좁힌다. 이 이중 게이트가 CHECK/FK 위반이
     * 우연히 "name"을 포함해도 오탐하지 않게 한다.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, Object>> handleIntegrity(DataIntegrityViolationException e) {
        String detail = rootMessage(e);
        boolean uniqueViolation = SQLSTATE_UNIQUE_VIOLATION.equals(sqlState(e));
        if (uniqueViolation && mentions(detail, "mc_datasource") && mentions(detail, "name")) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(envelope("DATASOURCE_NAME_DUPLICATE", "이미 같은 이름의 데이터소스가 있습니다.", null));
        }
        return ResponseEntity.badRequest()
                .body(envelope("INVALID_REQUEST", "요청이 데이터 제약을 위반했습니다.", null));
    }

    /** 최후 방어선 — 위에서 걸러지지 않은 미지의 예외만 500. requestId를 남겨 로그와 상관 지을 수 있게 한다. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleUnexpected(Exception e) {
        log.error("Unexpected error", e);
        return ResponseEntity.internalServerError()
                .body(envelope("INTERNAL_ERROR", "서버 오류가 발생했습니다.", null));
    }

    // ── 프레임워크(MVC) 표준 예외 — ResponseEntityExceptionHandler 훅 오버라이드 ──

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        Map<String, Object> fields = new LinkedHashMap<>();
        for (FieldError fe : ex.getBindingResult().getFieldErrors()) {
            fields.putIfAbsent(fe.getField(), fe.getDefaultMessage());
        }
        String message = fields.isEmpty() ? "요청이 유효하지 않습니다."
                : fields.entrySet().iterator().next().getKey() + " "
                        + fields.values().iterator().next();
        return respond(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, fields, headers);
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(
            HttpMessageNotReadableException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        return respond(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "요청 본문 형식이 올바르지 않습니다.", null, headers);
    }

    @Override
    protected ResponseEntity<Object> handleMissingServletRequestParameter(
            MissingServletRequestParameterException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        return respond(HttpStatus.BAD_REQUEST, "MISSING_PARAMETER",
                "필수 파라미터 '" + ex.getParameterName() + "'가 없습니다.", null, headers);
    }

    /** 타입 불일치 — 숫자 파라미터에 문자를 넣는 등. High 발견의 핵심(이전엔 500으로 낙하). */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, Object>> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        String type = ex.getRequiredType() == null ? "올바른 형식" : simpleTypeName(ex.getRequiredType());
        return ResponseEntity.badRequest().body(envelope("TYPE_MISMATCH",
                "'" + ex.getName() + "'은(는) " + type + "여야 합니다.", null));
    }

    /**
     * 그 밖의 모든 MVC 표준 예외(없는 라우트 404, 미지원 메서드 405, 미지원 미디어타입 415 등)의 공통 종착점.
     * ResponseEntityExceptionHandler가 이미 올바른 상태코드를 정해 주므로, body만 envelope로 바꾼다.
     */
    @Override
    protected ResponseEntity<Object> handleExceptionInternal(
            Exception ex, Object body, HttpHeaders headers, HttpStatusCode statusCode, WebRequest request) {
        HttpStatus status = HttpStatus.resolve(statusCode.value());
        if (status == null) status = HttpStatus.INTERNAL_SERVER_ERROR;
        return respond(status, codeFor(status), messageFor(status), null, headers);
    }

    // ── 헬퍼 ──────────────────────────────────────────────

    private static String codeFor(HttpStatus status) {
        return switch (status) {
            case NOT_FOUND -> "NOT_FOUND";
            case METHOD_NOT_ALLOWED -> "METHOD_NOT_ALLOWED";
            case UNSUPPORTED_MEDIA_TYPE -> "UNSUPPORTED_MEDIA_TYPE";
            case NOT_ACCEPTABLE -> "NOT_ACCEPTABLE";
            case BAD_REQUEST -> "INVALID_REQUEST";
            default -> status.is5xxServerError() ? "INTERNAL_ERROR" : "REQUEST_FAILED";
        };
    }

    private static String messageFor(HttpStatus status) {
        return switch (status) {
            case NOT_FOUND -> "요청한 경로를 찾을 수 없습니다.";
            case METHOD_NOT_ALLOWED -> "이 경로에서 지원하지 않는 요청 방식입니다.";
            case UNSUPPORTED_MEDIA_TYPE -> "지원하지 않는 요청 형식입니다.";
            case NOT_ACCEPTABLE -> "지원하지 않는 응답 형식 요청입니다.";
            case BAD_REQUEST -> "요청이 유효하지 않습니다.";
            default -> status.is5xxServerError() ? "서버 오류가 발생했습니다." : "요청을 처리하지 못했습니다.";
        };
    }

    private ResponseEntity<Object> respond(HttpStatus status, String code, String message,
                                           Map<String, Object> fields, HttpHeaders headers) {
        return ResponseEntity.status(status)
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .body((Object) envelope(code, message, fields));
    }

    private Map<String, Object> envelope(String code, String message, Map<String, Object> fields) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", code);
        error.put("message", message);
        if (fields != null && !fields.isEmpty()) error.put("fields", fields);
        String requestId = MDC.get("requestId");
        if (requestId != null && !requestId.isBlank()) error.put("requestId", requestId);
        return Map.of("error", error);
    }

    private static String simpleTypeName(Class<?> type) {
        if (Number.class.isAssignableFrom(type)
                || type == int.class || type == long.class || type == short.class
                || type == double.class || type == float.class) {
            return "숫자";
        }
        if (type == boolean.class || type == Boolean.class) return "true/false";
        return type.getSimpleName();
    }

    private static String rootMessage(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        String message = root.getMessage();
        return message == null ? "" : message;
    }

    /** 원인 체인에서 첫 {@link SQLException}의 SQLSTATE를 찾는다(표준 JDBC — 드라이버 클래스 불필요). */
    private static String sqlState(Throwable e) {
        for (Throwable t = e; t != null && t.getCause() != t; t = t.getCause()) {
            if (t instanceof SQLException sql && sql.getSQLState() != null) return sql.getSQLState();
        }
        return null;
    }

    private static boolean mentions(String haystack, String needle) {
        return haystack != null && haystack.toLowerCase().contains(needle.toLowerCase());
    }
}
