package cc.lik.footprint.finders;

import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.vo.FootprintVo;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ListResult;

public interface FootprintFinder {

    Flux<FootprintVo> listAll();

    Mono<ListResult<FootprintVo>> list(Integer page, Integer size);

    Mono<FootprintVo> getByName(String footprintName);

    Mono<ListResult<FootprintVo>> listByName(Integer page, Integer size,String footprintName);
}
