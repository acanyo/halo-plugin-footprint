package cc.lik.footprint;

import cc.lik.footprint.migration.SettingsMigration;
import cc.lik.footprint.model.Footprint;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import run.halo.app.extension.Scheme;
import run.halo.app.extension.SchemeManager;
import run.halo.app.extension.index.IndexSpecs;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;

/**
 * <p>足迹插件主类，管理插件的生命周期。</p>
 */
@Slf4j
@Component
public class FootprintPlugin extends BasePlugin {
    private final SchemeManager schemeManager;
    private final SettingsMigration settingsMigration;

    public FootprintPlugin(PluginContext pluginContext, SchemeManager schemeManager,
        SettingsMigration settingsMigration) {
        super(pluginContext);
        this.schemeManager = schemeManager;
        this.settingsMigration = settingsMigration;
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

        // 异步执行：start() 是同步生命周期方法，配置迁移不应阻塞插件启动。
        // 迁移完成前读配置会命中 FootprintServiceImpl 中的 globe3d 兜底，因此这里不存在竞态问题。
        settingsMigration.migrate()
            .subscribe(null, e -> log.error("足迹插件配置迁移未能完成", e));
    }

    @Override
    public void stop() {
        schemeManager.unregister(Scheme.buildFromType(Footprint.class));
    }
}
