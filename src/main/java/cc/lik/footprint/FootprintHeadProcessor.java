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

import java.util.Properties;

@Component
@RequiredArgsConstructor
public class FootprintHeadProcessor implements TemplateHeadProcessor {

    static final PropertyPlaceholderHelper PROPERTY_PLACEHOLDER_HELPER =
        new PropertyPlaceholderHelper("${", "}");

    private final PluginWrapper pluginWrapper;

    @Override
    public Mono<Void> process(ITemplateContext context, IModel model,
        IElementModelStructureHandler structureHandler) {
        final IModelFactory modelFactory = context.getModelFactory();
        
        Properties properties = new Properties();
        properties.setProperty("version", pluginWrapper.getDescriptor().getVersion());

        String script = PROPERTY_PLACEHOLDER_HELPER.replacePlaceholders("""
            <!-- footprint start -->
            <link rel="stylesheet" type="text/css" href="/plugins/footprint/assets/static/css/footprint.css?version=${version}" />
            <link rel="stylesheet" type="text/css" href="/plugins/footprint/assets/static/font/result.css?version=${version}" />
            <script type="text/javascript" src="/plugins/footprint/assets/static/js/footprint.js?version=${version}"></script>
            <!-- footprint end -->
            """, properties);
        
        model.add(modelFactory.createText(script));
        return Mono.empty();
    }
}
