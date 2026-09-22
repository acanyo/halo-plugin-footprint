<script lang="ts" setup>
import { Toast, VButton, VModal, VSpace, VLoading } from "@halo-dev/components";
import { nextTick, ref, watch } from "vue";
import { footprintApiClient } from "@/api";
import { loadAMap } from "@/utils/amap-loader";

/**
 * 高德地图选点。
 *
 * 解决的问题：原先只能填地址、保存后再点「解析」补省/市，地址写得不规范就
 * 全流程卡住。这里改为在地图上直接点选，落点即经纬度，并立刻逆地理编码出省/市，
 * 新建状态下同样可用。
 */
const props = withDefaults(
  defineProps<{
    visible: boolean;
    /** 打开时的初始落点，无则回落到地图默认中心 */
    longitude?: number;
    latitude?: number;
    /** 有地址时优先按地址定位，便于在已填地址的基础上微调 */
    address?: string;
  }>(),
  {
    visible: false,
    longitude: undefined,
    latitude: undefined,
    address: "",
  },
);

const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (
    event: "confirm",
    value: {
      longitude: number;
      latitude: number;
      province?: string;
      city?: string;
      provinceAdcode?: string;
      cityAdcode?: string;
    },
  ): void;
}>();

// 高德默认中心：未提供任何定位信息时落在杭州
const DEFAULT_CENTER: [number, number] = [120.15, 30.28];
const DEFAULT_ZOOM = 11;

const mapContainer = ref<HTMLDivElement>();
const loading = ref(false);
const loadError = ref("");
const picked = ref<{ longitude: number; latitude: number } | null>(null);
const geoInfo = ref<{ province?: string; city?: string; provinceAdcode?: string; cityAdcode?: string }>({});
const resolving = ref(false);
const searchKeyword = ref("");

// AMap 实例不放进 ref：它内部持有大量循环引用，被 Vue 做成响应式后
// 会显著拖慢地图交互，社区惯例是用普通变量持有。
let map: any = null;
let marker: any = null;

const onVisibleChange = (value: boolean) => {
  emit("update:visible", value);
};

/** 落点后统一走这里：移动标记 + 逆地理编码 */
const setPoint = async (longitude: number, latitude: number) => {
  picked.value = { longitude, latitude };
  if (marker) {
    marker.setPosition([longitude, latitude]);
  }
  resolving.value = true;
  geoInfo.value = {};
  try {
    const info = await footprintApiClient.footprint.reverseGeocode(longitude, latitude);
    geoInfo.value = info || {};
  } catch (e) {
    // 逆地理编码失败不影响选点本身，经纬度仍然可用
    console.error("逆地理编码失败", e);
    Toast.warning("已选择坐标，但省/市解析失败，可保存后重试解析");
  } finally {
    resolving.value = false;
  }
};

const initMap = async () => {
  loading.value = true;
  loadError.value = "";
  try {
    const config = await footprintApiClient.footprint.getMapConfig();
    if (!config.gaoDeKey) {
      loadError.value = "尚未配置高德 Js Key，请先在插件设置的「基本设置」中配置";
      return;
    }

    const AMap = await loadAMap(config.gaoDeKey);
    await nextTick();
    if (!mapContainer.value) return;

    const center: [number, number] =
      props.longitude != null && props.latitude != null
        ? [props.longitude, props.latitude]
        : DEFAULT_CENTER;

    map = new AMap.Map(mapContainer.value, {
      zoom: props.longitude != null ? 15 : DEFAULT_ZOOM,
      center,
      mapStyle: config.mapStyle || undefined,
    });

    // 高德对 Key 的域名白名单校验是异步的，失败时不会抛异常，只在控制台打
    // INVALID_USER_DOMAIN，页面上只剩一块空白。这里用 complete 事件加超时兜底，
    // 把「大概率是 Key 配置问题」直接说出来。
    let completed = false;
    map.on("complete", () => {
      completed = true;
    });
    window.setTimeout(() => {
      if (!completed && map) {
        loadError.value =
          "地图未能正常加载。常见原因：高德 Js Key 绑定的域名白名单不包含当前访问域名"
          + `（${window.location.host}）。请到高德控制台为该 Key 添加此域名，`
          + "或改用不限域名的 Key；具体错误可查看浏览器控制台。";
      }
    }, 5000);

    marker = new AMap.Marker({ position: center, draggable: true, cursor: "move" });
    map.add(marker);

    map.on("click", (e: any) => setPoint(e.lnglat.getLng(), e.lnglat.getLat()));
    marker.on("dragend", (e: any) => setPoint(e.lnglat.getLng(), e.lnglat.getLat()));

    if (props.longitude != null && props.latitude != null) {
      await setPoint(props.longitude, props.latitude);
    } else if (props.address) {
      // 已填地址但还没有坐标：先按地址定位一次，省去手动找位置
      await locateByAddress(props.address);
    }
  } catch (e) {
    console.error("地图加载失败", e);
    loadError.value = "地图加载失败，请检查高德 Js Key 是否有效、以及网络是否可访问高德服务";
  } finally {
    loading.value = false;
  }
};

/** 按地址定位。复用服务端已有的地址→经纬度接口，不在浏览器里直连高德。 */
const locateByAddress = async (address: string) => {
  const keyword = address.trim();
  if (!keyword) return;
  try {
    const location = await footprintApiClient.footprint.getLocation(keyword);
    const [lng, lat] = String(location).split(",").map(Number);
    if (isNaN(lng) || isNaN(lat)) {
      Toast.warning("没能根据该地址找到位置，请在地图上直接点选");
      return;
    }
    map?.setZoomAndCenter(15, [lng, lat]);
    await setPoint(lng, lat);
  } catch (e) {
    console.error("地址定位失败", e);
    Toast.warning("地址定位失败，请在地图上直接点选");
  }
};

const handleSearch = () => locateByAddress(searchKeyword.value);

const handleConfirm = () => {
  if (!picked.value) {
    Toast.warning("请先在地图上点选位置");
    return;
  }
  emit("confirm", { ...picked.value, ...geoInfo.value });
  onVisibleChange(false);
};

const destroyMap = () => {
  map?.destroy?.();
  map = null;
  marker = null;
  picked.value = null;
  geoInfo.value = {};
  searchKeyword.value = "";
  loadError.value = "";
};

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      searchKeyword.value = props.address || "";
      nextTick(initMap);
    } else {
      destroyMap();
    }
  },
);
</script>

<template>
  <VModal
    :visible="visible"
    :width="880"
    title="地图选点"
    :mask-closable="false"
    @update:visible="onVisibleChange"
  >
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <input
          v-model="searchKeyword"
          type="text"
          class="min-w-0 flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-900 outline-none"
          placeholder="输入地址后回车定位，或直接在地图上点选"
          @keyup.enter="handleSearch"
        />
        <VButton size="sm" @click="handleSearch">定位</VButton>
      </div>

      <div v-if="loadError" class="rounded-base bg-red-50 px-3 py-2 text-sm text-red-600">
        {{ loadError }}
      </div>

      <!--
        高度必须用内联样式：本插件的 ui 没有引入 Tailwind/UnoCSS，模板里那些
        工具类是靠 Halo Console 的全局样式表才生效的，而 h-[420px] 这类任意值
        类不可能预先存在于全局样式表中，写了等于没写，容器会塌成 0 高。
      -->
      <div
        class="relative w-full overflow-hidden rounded-base border border-gray-200"
        style="height: 420px"
      >
        <VLoading v-if="loading" />
        <div ref="mapContainer" style="height: 100%; width: 100%"></div>
      </div>

      <div class="rounded-base bg-gray-50 px-3 py-2 text-sm">
        <template v-if="picked">
          <span class="tabular-nums text-gray-900">
            {{ picked.longitude.toFixed(6) }}, {{ picked.latitude.toFixed(6) }}
          </span>
          <span class="ml-3 text-gray-500">
            <template v-if="resolving">省 / 市解析中…</template>
            <template v-else-if="geoInfo.province">
              {{ [geoInfo.province, geoInfo.city].filter(Boolean).join(" · ") }}
            </template>
            <template v-else>省 / 市未解析</template>
          </span>
        </template>
        <span v-else class="text-gray-500">点击地图或拖动标记选择位置</span>
      </div>
    </div>

    <template #footer>
      <VSpace>
        <VButton type="secondary" :disabled="!picked" @click="handleConfirm">确定</VButton>
        <VButton @click="onVisibleChange(false)">取消</VButton>
      </VSpace>
    </template>
  </VModal>
</template>
