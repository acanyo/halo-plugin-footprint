package cc.lik.footprint;

import static run.halo.app.extension.index.IndexAttributeFactory.simpleAttribute;

import cc.lik.footprint.model.Footprint;
import org.springframework.stereotype.Component;
import run.halo.app.extension.Scheme;
import run.halo.app.extension.SchemeManager;
import run.halo.app.extension.index.IndexSpec;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;

/**
 * <p>足迹插件主类，管理插件的生命周期。</p>
 */
@Component
public class FootprintPlugin extends BasePlugin {
    private final SchemeManager schemeManager;

    public FootprintPlugin(PluginContext pluginContext, SchemeManager schemeManager) {
        super(pluginContext);
        this.schemeManager = schemeManager;
    }

    @Override
    public void start() {
        schemeManager.register(Footprint.class, indexSpecs -> {
            indexSpecs.add (new IndexSpec()
                .setName("spec.author")
                .setIndexFunc(
                    simpleAttribute(Footprint.class,
                        footprint -> footprint.getSpec().getName())));
            indexSpecs.add (new IndexSpec()
                .setName("spec.footprintType")
                .setIndexFunc(
                    simpleAttribute(Footprint.class,
                        footprint -> footprint.getSpec().getFootprintType())));
            indexSpecs.add (new IndexSpec()
                .setName("spec.createTime")
                .setIndexFunc(
                    simpleAttribute(Footprint.class,
                        footprint -> String.valueOf(footprint.getSpec().getCreateTime()))));
        });
    }

    @Override
    public void stop() {
        schemeManager.unregister(Scheme.buildFromType(Footprint.class));
    }
}
