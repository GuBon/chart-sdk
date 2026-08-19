package com.chartsdk.admin;

import com.chartsdk.auth.CurrentUserProvider;
import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.OptionalLong;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AdminUserServiceTest {
    private final AdminUserRepository users = mock(AdminUserRepository.class);
    private final AdminAuditService audit = mock(AdminAuditService.class);
    private final CurrentUserProvider currentUser = mock(CurrentUserProvider.class);
    private final AdminUserService service = new AdminUserService(users, audit, currentUser);

    @Test
    void cannotDisableCurrentAccount() {
        actor(7);
        when(users.lockActiveAdminIds()).thenReturn(List.of(7L, 8L));
        when(users.lockUser(7)).thenReturn(new AdminUserRepository.UserState(7, "admin", "admin", true));

        assertThatThrownBy(() -> service.changeStatus(7, false))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("CANNOT_DISABLE_SELF");
        verify(users, never()).updateStatus(7, false);
    }

    @Test
    void protectsLastActiveAdminFromDemotion() {
        actor(7);
        when(users.lockActiveAdminIds()).thenReturn(List.of(7L));
        when(users.lockUser(7)).thenReturn(new AdminUserRepository.UserState(7, "admin", "admin", true));

        assertThatThrownBy(() -> service.changeRole(7, "member"))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("LAST_ADMIN_PROTECTED");
        verify(users, never()).updateRole(7, "member");
    }

    @Test
    void disablingMemberRevokesSessionsKeysAndLegacyCredentialsAtomically() {
        actor(7);
        when(users.lockActiveAdminIds()).thenReturn(List.of(7L));
        when(users.lockUser(9)).thenReturn(new AdminUserRepository.UserState(9, "member", "member", true));
        when(users.detail(9)).thenReturn(Map.of("user", Map.of("id", 9L)));

        service.changeStatus(9, false);

        verify(users).updateStatus(9, false);
        verify(users).deleteSessions("member");
        verify(users).revokeEmbedKeys(9);
        verify(users).revokeLegacyTokens(9);
        verify(audit).record(7, "USER_DISABLED", 9, Map.of("from", true, "to", false));
    }

    @Test
    void rejectsMutationIfActorLostAdminRoleAfterRequestAuthentication() {
        actor(7);
        when(users.lockActiveAdminIds()).thenReturn(List.of(8L));

        assertThatThrownBy(() -> service.changeStatus(9, false))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("ADMIN_AUTHORIZATION_CHANGED");
        verify(users, never()).lockUser(9);
    }

    private void actor(long id) {
        when(currentUser.currentUserId()).thenReturn(OptionalLong.of(id));
    }
}
