package com.chartsdk.web;

import com.chartsdk.chart.ChartService;
import com.chartsdk.chart.ChartListQuery;
import com.chartsdk.web.dto.ChartSaveRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/charts")
public class ChartController {
    private final ChartService charts;

    public ChartController(ChartService charts) {
        this.charts = charts;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String q,
                                    @RequestParam(required = false) String type,
                                    @RequestParam(required = false) Long datasourceId,
                                    @RequestParam(required = false) String schema,
                                    @RequestParam(required = false) String relation,
                                    @RequestParam(required = false) String sort,
                                    @RequestParam(required = false) Integer page,
                                    @RequestParam(required = false) Integer pageSize,
                                    @RequestParam(required = false) Long ownerId) {
        return charts.list(new ChartListQuery(q, type, datasourceId, schema, relation, sort, page, pageSize, ownerId));
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable long id) {
        return charts.get(id);
    }

    @GetMapping("/{id}/preview")
    public Map<String, Object> preview(@PathVariable long id) {
        return charts.preview(id);
    }

    @GetMapping("/previews")
    public Map<String, Object> previews(@RequestParam String ids) {
        return charts.previews(ids);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@Valid @RequestBody ChartSaveRequest input) {
        return charts.create(input);
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable long id, @Valid @RequestBody ChartSaveRequest input) {
        return charts.update(id, input);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) {
        charts.delete(id);
    }

    @PostMapping("/{id}/refresh")
    public Map<String, Object> refresh(@PathVariable long id) {
        return charts.refresh(id);
    }

    @PostMapping("/{id}/duplicate")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> duplicate(@PathVariable long id) {
        return charts.duplicate(id);
    }
}
