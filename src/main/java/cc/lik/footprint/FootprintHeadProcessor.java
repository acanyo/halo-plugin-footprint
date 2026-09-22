package cc.lik.footprint;

import lombok.RequiredArgsConstructor;
import org.pf4j.PluginWrapper;
import org.springframework.stereotype.Component;
import org.springframework.util.PropertyPlaceholderHelper;
import org.thymeleaf.context.ITemplateContext;
import org.thymeleaf.model.IModel;
import org.thymeleaf.model.IModelFactory;
import org.thymeleaf.processor.element.IElementModelStructureHandler;
import reactor.core.publisher.Mono;
import run.halo.app.theme.dialect.TemplateHeadProcessor;
import run.halo.app.theme.router.ModelConst;

import java.util.Properties;

@Component
@RequiredArgsConstructor
public class FootprintHeadProcessor implements TemplateHeadProcessor {

    static final PropertyPlaceholderHelper PROPERTY_PLACEHOLDER_HELPER =
        new PropertyPlaceholderHelper("${", "}");

    /**
     * 足迹页的 _templateId：只有渲染这个页面时才注入 3D 地球那一套资源。
     */
    private static final String FOOTPRINT_TEMPLATE_ID = "plugin:footprint:footprints";

    /**
     * 足迹页特有的模型字段，作为 _templateId 没有透传时的第二道判据。
     */
    private static final String FOOTPRINT_MODEL_KEY = "footprints";

    private final PluginWrapper pluginWrapper;

    @Override
    public Mono<Void> process(ITemplateContext context, IModel model,
        IElementModelStructureHandler structureHandler) {
        // 这里输出的资源全部只服务于足迹页（2D 老页面 + 3D 地球 + 票根字体），
        // 而 Head 处理器是全局注入点：先确认当前渲染的就是足迹页，别的页面一个字节都不输出。
        if (!isFootprintPage(context)) {
            return Mono.empty();
        }

        final IModelFactory modelFactory = context.getModelFactory();

        Properties properties = new Properties();
        properties.setProperty("version", pluginWrapper.getDescriptor().getVersion());

        String legacyScript = PROPERTY_PLACEHOLDER_HELPER.replacePlaceholders("""
            <!-- footprint start -->
            <link rel="stylesheet" type="text/css" href="/plugins/footprint/assets/static/css/footprint.css?version=${version}" />
            <link rel="stylesheet" type="text/css" href="/plugins/footprint/assets/static/font/result.css?version=${version}" />
            <script type="text/javascript" src="/plugins/footprint/assets/static/js/footprint.js?version=${version}"></script>
            <!-- footprint end -->
            """, properties);

        model.add(modelFactory.createText(legacyScript));

        // 3D 地球那套：版本号统一取插件版本（gradle.properties 的 version），
        // 升级插件即自动失效缓存，不用再手改模板里的 v1xx。
        // 用 defer 是因为 Head 处理器只能写进 <head>，而这两个脚本必须在 DOM 就绪后执行。
        String globeScript = PROPERTY_PLACEHOLDER_HELPER.replacePlaceholders("""
            <!-- footprint globe start -->
            <link rel="stylesheet" type="text/css" href="/plugins/footprint/assets/static/css/travel-memory.css?version=${version}" />
            <script defer type="text/javascript" src="/plugins/footprint/assets/static/data/district-pinyin.js?version=${version}"></script>
            <script defer type="text/javascript" src="/plugins/footprint/assets/static/js/travel-memory.js?version=${version}"></script>
            <!-- footprint globe end -->
            """, properties);
        model.add(modelFactory.createText(globeScript));
        return Mono.empty();
    }

    /**
     * 判断当前渲染的是不是足迹页。
     *
     * <p>优先用 Halo 约定的 {@link ModelConst#TEMPLATE_ID}（由 FootprintRouter 写入），
     * 万一该变量没有透传到 Head 处理器的上下文，再用足迹页独有的模型字段兜底。</p>
     */
    private boolean isFootprintPage(ITemplateContext context) {
        if (FOOTPRINT_TEMPLATE_ID.equals(context.getVariable(ModelConst.TEMPLATE_ID))) {
            return true;
        }
        return context.getVariable(FOOTPRINT_MODEL_KEY) != null;
    }
}
