package com.chartsdk.admin;

import com.chartsdk.auth.CurrentUserProvider;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class AdminUserService {
    private static final Set<String> STATUSES = Set.of("", "active", "inactive");
    private static final Set<String> ROLES = Set.of("", "member", "admin");

    private final AdminUserRepository users;
    private final AdminAuditService audit;
    private final CurrentUserProvider currentUser;

    public AdminUserService(AdminUserRepository users, AdminAuditService audit,
                            CurrentUserProvider currentUser) {
        this.users = users;
        this.audit = audit;
        this.currentUser = currentUser;
    }

    public Map<String, Object> list(String q, String status, String role, Integer page, Integer pageSize) {
        String safeStatus = status == null ? "" : status.strip().toLowerCase();
        String safeRole = role == null ? "" : role.strip().toLowerCase();
        if (!STATUSES.contains(safeStatus)) {
            throw invalidFilter("status", "status는 active 또는 inactive여야 합니다.");
        }
        if (!ROLES.contains(safeRole)) {
            throw invalidFilter("role", "role은 member 또는 admin이어야 합니다.");
        }
        return users.list(q, safeStatus, safeRole, page, pageSize);
    }

    public Map<String, Object> detail(long userId) {
        return users.detail(userId);
    }

    @Transactional
    public Map<String, Object> changeStatus(long userId, boolean active) {
        long actorId = actorId();
        List<Long> activeAdmins = users.lockActiveAdminIds();
        requireStillAdmin(actorId, activeAdmins);
        AdminUserRepository.UserState target = users.lockUser(userId);
        if (target.active() == active) return users.detail(userId);
        if (!active && actorId == userId) {
            throw new ApiException(HttpStatus.CONFLICT, "CANNOT_DISABLE_SELF",
                    "현재 로그인한 관리자 계정은 비활성화할 수 없습니다.");
        }
        if (!active && target.active() && "admin".equals(target.role()) && activeAdmins.size() <= 1) {
            throw lastAdmin();
        }

        users.updateStatus(userId, active);
        users.deleteSessions(target.username());
        if (!active) {
            users.revokeEmbedKeys(userId);
            users.revokeLegacyTokens(userId);
        }
        audit.record(actorId, active ? "USER_ACTIVATED" : "USER_DISABLED", userId,
                Map.of("from", target.active(), "to", active));
        return users.detail(userId);
    }

    @Transactional
    public Map<String, Object> changeRole(long userId, String role) {
        long actorId = actorId();
        List<Long> activeAdmins = users.lockActiveAdminIds();
        requireStillAdmin(actorId, activeAdmins);
        AdminUserRepository.UserState target = users.lockUser(userId);
        if (target.role().equals(role)) return users.detail(userId);
        if (target.active() && "admin".equals(target.role()) && "member".equals(role)
                && activeAdmins.size() <= 1) {
            throw lastAdmin();
        }

        users.updateRole(userId, role);
        users.deleteSessions(target.username());
        audit.record(actorId, "USER_ROLE_CHANGED", userId,
                Map.of("from", target.role(), "to", role));
        return users.detail(userId);
    }

    private long actorId() {
        return currentUser.currentUserId().orElseThrow(() ->
                new ApiException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "로그인이 필요합니다."));
    }

    private static void requireStillAdmin(long actorId, List<Long> activeAdmins) {
        if (!activeAdmins.contains(actorId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "ADMIN_AUTHORIZATION_CHANGED",
                    "관리자 권한이 변경되었습니다. 다시 로그인해 주세요.");
        }
    }

    private static ApiException invalidFilter(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, Map.of(field, message));
    }

    private static ApiException lastAdmin() {
        return new ApiException(HttpStatus.CONFLICT, "LAST_ADMIN_PROTECTED",
                "마지막 활성 관리자 계정은 비활성화하거나 일반 사용자로 변경할 수 없습니다.");
    }
}
