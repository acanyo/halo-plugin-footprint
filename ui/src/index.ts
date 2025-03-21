import { definePlugin } from "@halo-dev/console-shared";
import Footprint from "./views/Footprint.vue";
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
  extensionPoints: {},
});
