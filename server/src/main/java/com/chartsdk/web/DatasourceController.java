package com.chartsdk.web;

import com.chartsdk.datasource.DatasourceInput;
import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.datasource.DatasourceTestInput;
import com.chartsdk.datasource.DatasourceView;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.http.HttpStatus;

import java.util.Map;

/** HTTP 경계. 데이터소스 검증·영속화·연결 시험은 DatasourceService에 위임한다. */
@RestController
@RequestMapping("/api/v1/datasources")
public class DatasourceController {
    private final DatasourceService datasources;

    public DatasourceController(DatasourceService datasources) {
        this.datasources = datasources;
    }

    @GetMapping
    public Map<String, Object> list() {
        return Map.of("datasources", datasources.list());
    }

    @PostMapping
    public DatasourceView create(@RequestBody DatasourceInput input) {
        return datasources.create(input);
    }

    @PutMapping("/{id}")
    public DatasourceView update(@PathVariable long id, @RequestBody DatasourceInput input) {
        return datasources.update(id, input);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) {
        datasources.delete(id);
    }

    @PostMapping("/test")
    public DatasourceService.ConnectionTestResult test(@RequestBody DatasourceTestInput input) {
        return datasources.test(input);
    }
}
