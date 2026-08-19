package com.chartsdk.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.MDC;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class AdminAuditService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public AdminAuditService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public void record(long actorId, String action, long targetId, Map<String, Object> details) {
        try {
            jdbc.update("""
                    INSERT INTO mc_admin_audit_log(
                        actor_user_id, action, target_type, target_id, details, request_id)
                    VALUES (?, ?, 'USER', ?, ?::jsonb, ?)
                    """, actorId, action, targetId, mapper.writeValueAsString(details), MDC.get("requestId"));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize admin audit details", e);
        }
    }
}
