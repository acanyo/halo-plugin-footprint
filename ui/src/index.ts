import { definePlugin } from "@halo-dev/ui-shared";
import Footprint from "./views/Footprint.vue";
import FootprintStatsWidget from "./components/dashboard/FootprintStatsWidget.vue";
import RiMapPinLine from "~icons/ri/map-pin-line";
import { markRaw } from "vue";

export default definePlugin({
  components: {},
  routes: [
    {
      parentName: "Root",
      route: {
        path: "/footprint",
        name: "Footprint",
        component: Footprint,
        meta: {
          title: "足迹",
          searchable: true,
          permissions: ["plugin:footprint:view"],
          menu: {
            name: "足迹",
            group: "content",
            icon: markRaw(RiMapPinLine),
            priority: 0,
          },
        },
      },
    },
  ],
  extensionPoints: {
    // 仪表盘小组件：只做"一眼概览"，完整口径留在足迹管理页（见组件头部注释）
    "console:dashboard:widgets:create": () => [
      {
        id: "footprint:stats",
        component: markRaw(FootprintStatsWidget),
        group: "足迹",
        configFormKitSchema: [
          {
            $formkit: "text",
            name: "title",
            label: "标题",
            value: "足迹统计",
          },
          {
            $formkit: "select",
            name: "view",
            label: "显示内容",
            value: "overview",
            options: [
              { label: "总览：总数 / 覆盖 / 照片票根 / 最近一次", value: "overview" },
              { label: "排行：省份或城市 Top N", value: "ranking" },
              { label: "类型分布：按足迹类型", value: "types" },
              { label: "年份分布：按年份", value: "years" },
            ],
          },
          {
            $formkit: "select",
            name: "rankBy",
            label: "排行维度（排行视图）",
            value: "province",
            options: [
              { label: "省份", value: "province" },
              { label: "城市", value: "city" },
            ],
          },
          {
            $formkit: "number",
            name: "topN",
            label: "排行条数（排行视图）",
            value: 5,
            min: 3,
            max: 10,
            step: 1,
          },
        ],
        defaultConfig: {
          title: "足迹统计",
          view: "overview",
          rankBy: "province",
          topN: 5,
        },
        defaultSize: { w: 4, h: 7, minW: 3, minH: 5, maxW: 12, maxH: 12 },
        permissions: ["plugin:footprint:view"],
      },
    ],
    // 快速操作：一键进足迹管理页（路由由 Halo 处理，不需要我们自己导航）
    "console:dashboard:widgets:internal:quick-action:item:create": () => [
      {
        id: "footprint:manage",
        icon: markRaw(RiMapPinLine),
        title: "足迹管理",
        route: { name: "Footprint" },
        permissions: ["plugin:footprint:view"],
      },
    ],
  },
});
