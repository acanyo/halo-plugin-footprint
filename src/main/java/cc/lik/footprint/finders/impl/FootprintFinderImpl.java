package cc.lik.footprint.finders.impl;

import static org.springframework.data.domain.Sort.Order.asc;
import static run.halo.app.extension.index.query.QueryFactory.all;
import static run.halo.app.extension.index.query.QueryFactory.and;
import static run.halo.app.extension.index.query.QueryFactory.equal;
import static run.halo.app.extension.index.query.QueryFactory.isNull;

import cc.lik.footprint.finders.FootprintFinder;
import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.vo.FootprintVo;
import jakarta.annotation.Nonnull;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.apache.commons.lang3.ObjectUtils;
import org.springframework.data.domain.Sort;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.ListResult;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.PageRequest;
import run.halo.app.extension.PageRequestImpl;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.router.selector.FieldSelector;
import run.halo.app.theme.finders.Finder;


@Finder("footprintFinder")
@RequiredArgsConstructor
public class FootprintFinderImpl implements FootprintFinder {

    private final ReactiveExtensionClient client;



    @Override
    public Flux<FootprintVo> listAll() {
        var listOptions = new ListOptions();
        var query = all();
        listOptions.setFieldSelector(FieldSelector.of(query));
        return client.listAll(Footprint.class, listOptions, defaultSort())
            .flatMap(this::getFootprintVo);
    }

    @Override
    public Mono<ListResult<FootprintVo>> list(Integer page, Integer size) {
        var pageRequest = PageRequestImpl.of(pageNullSafe(page), sizeNullSafe(size), defaultSort());
        return pageFootprintPost(null, pageRequest);
    }


    @Override
    public Mono<FootprintVo> getByName(String footprintName) {
        return client.fetch(Footprint.class, footprintName)
            .map(FootprintVo::from);
    }

    @Override
    public Mono<ListResult<FootprintVo>> listByName(Integer page, Integer size,String name) {
        var query = equal("spec.name", name);
        var pageRequest = PageRequestImpl.of(pageNullSafe(page), sizeNullSafe(size), defaultSort());
        return pageFootprintPost(FieldSelector.of(query), pageRequest);
    }


    private Mono<ListResult<FootprintVo>> pageFootprintPost(FieldSelector fieldSelector, PageRequest page){
        var listOptions = new ListOptions();
        var query = all();
        if (fieldSelector != null) {
            query = and(query, fieldSelector.query());
        }
        listOptions.setFieldSelector(FieldSelector.of(query));
        return client.listBy(Footprint.class, listOptions, page)
            .flatMap(list -> Flux.fromStream(list.get())
                .concatMap(this::getFootprintVo)
                .collectList()
                .map(footprintVos -> new ListResult<>(list.getPage(), list.getSize(),
                    list.getTotal(), footprintVos)
                )
            )
            .defaultIfEmpty(
                new ListResult<>(page.getPageNumber(), page.getPageSize(), 0L, List.of()));

    }

    static Sort defaultLinkSort() {
        return Sort.by(asc("spec.priority"),
            asc("metadata.creationTimestamp"),
            asc("metadata.name")
        );
    }

    static Sort defaultSort() {
        return Sort.by("spec.createTime").descending();
    }

    private Mono<FootprintVo> getFootprintVo(@Nonnull Footprint footprint) {
        FootprintVo footprintVo = FootprintVo.from(footprint);
        return Mono.just(footprintVo);
    }

    int pageNullSafe(Integer page) {
        return ObjectUtils.defaultIfNull(page, 1);
    }

    int sizeNullSafe(Integer size) {
        return ObjectUtils.defaultIfNull(size, 10);
    }


}
