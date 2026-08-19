package com.chartsdk.admin;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/users")
public class AdminUserController {
    private final AdminUserService users;

    public AdminUserController(AdminUserService users) {
        this.users = users;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String q,
                                    @RequestParam(required = false) String status,
                                    @RequestParam(required = false) String role,
                                    @RequestParam(required = false) Integer page,
                                    @RequestParam(required = false) Integer pageSize) {
        return users.list(q, status, role, page, pageSize);
    }

    @GetMapping("/{userId}")
    public Map<String, Object> detail(@PathVariable long userId) {
        return users.detail(userId);
    }

    @PatchMapping("/{userId}/status")
    public Map<String, Object> status(@PathVariable long userId,
                                      @Valid @RequestBody AdminUserStatusRequest input) {
        return users.changeStatus(userId, input.active());
    }

    @PatchMapping("/{userId}/role")
    public Map<String, Object> role(@PathVariable long userId,
                                    @Valid @RequestBody AdminUserRoleRequest input) {
        return users.changeRole(userId, input.role());
    }
}
