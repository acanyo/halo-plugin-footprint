package cc.lik.footprint;

import cc.lik.footprint.model.Footprint;
import org.pf4j.PluginWrapper;
import org.springframework.stereotype.Component;
import run.halo.app.extension.Scheme;
import run.halo.app.extension.SchemeManager;
import run.halo.app.extension.index.IndexSpecs;
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
            indexSpecs.add(IndexSpecs.<Footprint, String>single("spec.name", String.class)
                .indexFunc(footprint -> footprint.getSpec().getName())
                .build());
            indexSpecs.add(IndexSpecs.<Footprint, String>single("spec.footprintType", String.class)
                .indexFunc(footprint -> footprint.getSpec().getFootprintType())
                .build());
        });
    }

    @Override
    public void stop() {
        schemeManager.unregister(Scheme.buildFromType(Footprint.class));
    }
}
