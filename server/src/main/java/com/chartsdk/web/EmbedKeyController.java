package com.chartsdk.web;

import com.chartsdk.token.EmbedKeyService;
import com.chartsdk.token.IssuedEmbedKey;
import com.chartsdk.web.dto.EmbedKeyIssueRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;

import java.util.Map;

/** S3 임베드 코드 모달용 관리 API — 키 목록·발급·회수. 임베드 데이터 서빙은 EmbedController 가 담당. */
@RestController
@RequestMapping("/api/v1")
public class EmbedKeyController {
    private final EmbedKeyService embedKeys;

    public EmbedKeyController(EmbedKeyService embedKeys) {
        this.embedKeys = embedKeys;
    }

    @GetMapping("/charts/{chartId}/embed-keys")
    public Map<String, Object> list(@PathVariable long chartId) {
        return Map.of("embedKeys", embedKeys.listForChart(chartId));
    }

    @PostMapping("/charts/{chartId}/embed-keys")
    public IssuedEmbedKey issue(@PathVariable long chartId,
                                @Valid @RequestBody EmbedKeyIssueRequest body) {
        int days = body.expiresInDays() != null ? body.expiresInDays() : 365;
        return embedKeys.issue(chartId, body.userId(), days);
    }

    @DeleteMapping("/embed-keys/{keyId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@PathVariable long keyId) {
        embedKeys.revoke(keyId);
    }
}
