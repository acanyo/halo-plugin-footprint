package cc.lik.footprint;

import static java.util.Comparator.comparing;
import static org.springdoc.core.fn.builders.parameter.Builder.parameterBuilder;
import static run.halo.app.extension.index.query.QueryFactory.contains;
import static run.halo.app.extension.index.query.QueryFactory.equal;
import static run.halo.app.extension.router.QueryParamBuildUtil.sortParameter;

import cc.lik.footprint.model.Footprint;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import org.apache.commons.lang3.StringUtils;
import org.springdoc.core.fn.builders.operation.Builder;
import org.springframework.data.domain.Sort;
import org.springframework.lang.Nullable;
import org.springframework.web.reactive.function.server.ServerRequest;
import run.halo.app.core.extension.endpoint.SortResolver;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.PageRequest;
import run.halo.app.extension.PageRequestImpl;
import run.halo.app.extension.router.IListRequest;
import run.halo.app.extension.router.SortableRequest;

public class FootprintQuery extends SortableRequest {


    public FootprintQuery(ServerRequest request) {
        super(request.exchange());
    }

    @Nullable
    public String getKeyword() {
        return StringUtils.defaultIfBlank(queryParams.getFirst("keyword"), null);
    }

    @Nullable
    public String getAuthor() {
        return queryParams.getFirst("author");
    }

    @Nullable
    public String getFootprintType() {
        return queryParams.getFirst("footprintType");
    }

    public ListOptions toListOptions() {
        var builder = ListOptions.builder(super.toListOptions());

        Optional.ofNullable(getKeyword())
            .filter(StringUtils::isNotBlank)
            .ifPresent(keyword -> {
                builder.andQuery(contains("spec.name", keyword));
            });

        Optional.ofNullable(getAuthor())
            .filter(StringUtils::isNotBlank)
            .ifPresent(author -> builder.andQuery(equal("spec.author", author)));

        Optional.ofNullable(getFootprintType())
            .filter(StringUtils::isNotBlank)
            .ifPresent(footprintType -> builder.andQuery(equal("spec.footprintType", footprintType)));

        return builder.build();
    }

    public Comparator<Footprint> toComparator() {
        List<Comparator<Footprint>> comparators = new ArrayList<>();
        var sort = getSort();
        var ctOrder = sort.getOrderFor("createTime");
        if (ctOrder != null) {
            Comparator<Footprint> comparator =
                comparing(footprint -> footprint.getSpec().getCreateTime());
            if (ctOrder.isDescending()) {
                comparator = comparator.reversed();
            }
            comparators.add(comparator);
        }
        Comparator<Footprint> defaultComparator =
            comparing(footprint -> footprint.getSpec().getCreateTime());
        comparators.add(defaultComparator.reversed());
        return comparators.stream()
            .reduce(Comparator::thenComparing)
            .orElse(null);
    }


    public Sort getSort() {
        var sort = SortResolver.defaultInstance.resolve(exchange);
        return sort.and(Sort.by("spec.createTime").descending());
    }

    public PageRequest toPageRequest() {
        return PageRequestImpl.of(getPage(), getSize(), getSort());
    }

    public static void buildParameters(Builder builder) {
        IListRequest.buildParameters(builder);
        builder.parameter(sortParameter())
            .parameter(parameterBuilder()
                .in(ParameterIn.QUERY)
                .name("keyword")
                .description("Footprints filtered by keyword.")
                .implementation(String.class)
                .required(false))
            .parameter(parameterBuilder()
                .in(ParameterIn.QUERY)
                .name("author")
                .description("Footprints filtered by author.")
                .implementation(String.class)
                .required(false))
            .parameter(parameterBuilder()
                .in(ParameterIn.QUERY)
                .name("footprintType")
                .description("Footprints filtered by footprintType.")
                .implementation(String.class)
                .required(false))

        ;
    }


} 