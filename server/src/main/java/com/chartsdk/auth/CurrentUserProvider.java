package com.chartsdk.auth;

import java.util.OptionalLong;

public interface CurrentUserProvider {
    OptionalLong currentUserId();
}
