import { accentHex, accentRgba } from '../shared/accent.js';

(async () => {
    'use strict';

    const root = document.getElementById('travelMemoryWall');
    const openButton = document.getElementById('travelWallBtn');
    if (!root) return;

    const travelWallPath = '/footprints/memory-wall';
    const footprintConfig = window.FOOTPRINT_CONFIG || {};
    const configuredTitle = String(
        footprintConfig.travelWallTitle || '城市记忆墙'
    ).trim();
    const configuredMotto = String(
        footprintConfig.travelWallMotto || '人生得意须尽欢'
    ).trim();
    const directTravelWall = footprintConfig.travelWallDirect === true;
    const allowedWallStyles = new Set([
        'classic',
        'scrapbook'
    ]);
    const wallStyleParams = new URLSearchParams(window.location.search);
    const requestedWallStyle = (
        wallStyleParams.get('debug') === '1'
            ? wallStyleParams.get('wallStyle')
            : ''
    ) || footprintConfig.travelWallStyle || 'classic';
    const configuredWallStyle = allowedWallStyles.has(
        String(requestedWallStyle).trim()
    ) ? String(requestedWallStyle).trim() : 'classic';
    root.dataset.sceneStyle = configuredWallStyle;
    const mottoFont = '"Ma Shan Zheng", "KaiTi", "STKaiti", serif';
    const wallAccent = accentHex();

    async function ensureMottoFontReady() {
        if (!configuredMotto || !document.fonts || !document.fonts.load) {
            return;
        }
        try {
            await document.fonts.load(
                '400 72px "Ma Shan Zheng"',
                configuredMotto
            );
        } catch (error) {
            console.warn('[travel-wall] motto font failed to load', error);
        }
    }

    async function loadTravelWallData() {
        const footprints = footprintConfig.footprints || [];
        if (!Array.isArray(footprints)) {
            throw new Error('足迹数据格式不正确');
        }
        const normalized = footprints
            .map(normalizeFootprint)
            .filter(Boolean);
        if (!normalized.length) {
            throw new Error('足迹接口没有返回有效数据');
        }
        let geo = footprintConfig.geo;
        if (!geo) {
            const geoUrl =
                '/plugins/footprint/assets/static/data/china-full.json';
            const geoResponse = await fetch(geoUrl, { cache: 'force-cache' });
            if (!geoResponse.ok) {
                throw new Error('地图数据请求失败：HTTP ' + geoResponse.status);
            }
            geo = await geoResponse.json();
        }
        return {
            generatedAt: new Date().toISOString(),
            source: 'FOOTPRINT_CONFIG',
            footprints: normalized,
            geo
        };
    }

    function normalizeFootprint(item) {
        const spec = item && (item.spec || item);
        const longitude = Number(spec && (
            spec.longitude !== undefined ? spec.longitude : spec.lng
        ));
        const latitude = Number(spec && (
            spec.latitude !== undefined ? spec.latitude : spec.lat
        ));
        if (!spec ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(latitude)) {
            return null;
        }
        const seen = new Set();
        const photos = [];
        const gallery = Array.isArray(spec.galleryImages)
            ? spec.galleryImages : [];
        gallery
            .slice()
            .sort((a, b) => Number(a && a.order) - Number(b && b.order))
            .forEach(image => {
                const url = typeof image === 'string'
                    ? image : image && image.url;
                if (!url || seen.has(url)) return;
                seen.add(url);
                photos.push(url);
            });
        if (!photos.length && Array.isArray(spec.photos)) {
            spec.photos.forEach(url => {
                if (!url || seen.has(url)) return;
                seen.add(url);
                photos.push(url);
            });
        }
        const mainImage = spec.image || spec.mainImage || '';
        if (!photos.length && mainImage) photos.push(mainImage);
        return {
            key: item.metadata && item.metadata.name ||
                item.key || 'footprint-' + stableFootprintKey(spec),
            name: spec.name || '',
            description: spec.description || '',
            lng: longitude,
            lat: latitude,
            city: spec.city || '',
            province: spec.province || '',
            cityAdcode: String(spec.cityAdcode || ''),
            provinceAdcode: String(spec.provinceAdcode || ''),
            type: spec.footprintType || spec.type || '',
            createTime: spec.createTime || '',
            photos,
            mainImage,
            ticketImage: spec.ticketImage || '',
            ticketTitle: spec.ticketTitle || '',
            ticketRoute: spec.ticketRoute || ''
        };
    }

    function wallThumbnailUrl(url) {
        if (!url) return url;
        const cityFrom = footprintConfig.cityWallImageFrom;
        const cityTo = footprintConfig.cityWallImageTo;
        const citySuffix = footprintConfig.cityWallImageSuffix;
        if (!cityFrom && !cityTo && !citySuffix) {
            const from = footprintConfig.markerImageFrom;
            const to = footprintConfig.markerImageTo;
            if (from && to && String(url).includes(from)) {
                return String(url).split(from).join(to);
            }
            return url;
        }
        let output = String(url);
        if (cityFrom) output = output.split(cityFrom).join(cityTo || '');
        if (citySuffix && !output.endsWith(citySuffix)) output += citySuffix;
        return output;
    }

    function stableFootprintKey(spec) {
        return [
            spec.name, spec.longitude, spec.latitude, spec.createTime
        ].join('|');
    }

    let data = null;

    const canvas = document.getElementById('wallCanvas');
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const dragSurface = document.createElement('div');
    const dragBackdrop = document.createElement('canvas');
    const dragCanvas = document.createElement('canvas');
    const dragLighting = document.createElement('canvas');
    dragSurface.className = 'wall-drag-surface';
    dragBackdrop.className = 'wall-drag-backdrop';
    dragCanvas.className = 'wall-drag-canvas';
    dragLighting.className = 'wall-drag-lighting';
    dragSurface.setAttribute('aria-hidden', 'true');
    dragSurface.append(dragBackdrop, dragCanvas, dragLighting);
    canvas.insertAdjacentElement('afterend', dragSurface);
    const dragBackdropCtx = dragBackdrop.getContext('2d');
    const dragCtx = dragCanvas.getContext('2d', {
        alpha: true,
        desynchronized: true
    });
    const dragLightingCtx = dragLighting.getContext('2d');
    const body = root;
    const loadingState = document.getElementById('loadingState');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingDetail = document.getElementById('loadingDetail');
    const loadingBar = document.getElementById('loadingBar');
    const wallSummary = document.getElementById('wallSummary');
    const wallYearControl = document.querySelector('.wall-year-filter');
    const wallYearTrigger = document.getElementById('wallYearTrigger');
    const wallYearValue = document.getElementById('wallYearValue');
    const wallYearMenu = document.getElementById('wallYearMenu');
    const travelWallBack = document.getElementById('travelWallBack');
    const debugPanel = document.getElementById('debugPanel');
    const debugText = document.getElementById('debugText');
    const stressBtn = document.getElementById('stressBtn');
    const zoomValue = document.getElementById('zoomValue');
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const fitBtn = document.getElementById('fitBtn');
    const exportBtn = document.getElementById('exportBtn');
    const immersiveBtn = document.getElementById('immersiveBtn');
    const immersiveExitBtn = document.getElementById('immersiveExitBtn');
    const preview = document.getElementById('photoPreview');
    const previewFigure = preview.querySelector('figure');
    const previewImage = document.getElementById('previewImage');
    const previewTitle = document.getElementById('previewTitle');
    const previewMeta = document.getElementById('previewMeta');
    const previewDescription = document.getElementById('previewDescription');
    const previewCloseBtn = document.getElementById('previewCloseBtn');
    const previewPrevBtn = document.getElementById('previewPrevBtn');
    const previewNextBtn = document.getElementById('previewNextBtn');
    const previewTransitionCanvas = document.createElement('canvas');
    previewTransitionCanvas.className = 'preview-transition-photo';
    previewTransitionCanvas.setAttribute('aria-hidden', 'true');
    preview.append(previewTransitionCanvas);
    const previewTransitionCtx = previewTransitionCanvas.getContext('2d');
    const exportProgress = document.getElementById('exportProgress');
    const exportProgressText = document.getElementById('exportProgressText');
    const exportProgressBar = document.getElementById('exportProgressBar');
    const exportCancelBtn = document.getElementById('exportCancelBtn');
    const miniMapCanvas = document.getElementById('miniMapCanvas');
    const miniMapCtx = miniMapCanvas.getContext('2d');
    const returnMapBtn = document.getElementById('returnMapBtn');
    const tooSmallNotice = document.getElementById('tooSmallNotice');
    const debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fontText = getComputedStyle(body).fontFamily;
    const gestureNote = root.querySelector('.gesture-note');

    function dismissGestureNote() {
        if (gestureNote) gestureNote.classList.add('is-dismissed');
    }

    function setLoadingPhase(title, detail, progress) {
        loadingTitle.textContent = title;
        loadingDetail.textContent = detail || '';
        loadingBar.style.width = clamp(Number(progress) || 0, 0, 100) + '%';
        loadingState.classList.remove('is-hidden');
    }

    function completeLoadingState() {
        if (!sceneReady || imagesLoading() ||
            loadingState.classList.contains('is-hidden')) {
            return;
        }
        setLoadingPhase('旅行记忆墙已就绪', '可以自由拖动、缩放和查看照片', 100);
        loadingFinished = true;
        loadingState.classList.add('is-passive', 'is-hidden');
        playInitialFitTransition();
    }

    const MAP_WIDTH = 960;
    const MAP_HEIGHT = 680;
    const MAP_GAP = 28;
    const WORLD_PADDING = 120;
    const LAYOUT_CELL = 10;
    const LAYOUT_GAP = 10;
    const LOCAL_GROUP_GAP = 2;
    const PHOTO_FRAME = 3;
    const LABEL_CLEARANCE = 3;
    const CITY_TITLE_CLEARANCE = 48;
    const ADJACENT_GROUP_TARGET_GAP = 32;
    const ADJACENT_GROUP_MAX_STEP = 24;
    const ADJACENT_GROUP_PASSES = 8;
    const MAP_PULL_STEP = 16;
    const MAP_PULL_LIMIT = 96;
    const LABEL_ZOOM_THRESHOLD = 1.15;
    const EXPORT_SQUARE_PADDING = 64;
    const MAP_CLEARANCE = 14;
    const GROUP_COMPONENT_GAP = 18;
    const LAYOUT_RING_STEP = 16;
    const LAYOUT_RING_LIMIT = 1300;
    const GAP_GRID_CELL = 8;
    const GAP_MIN_COMPONENT_AREA = 4000;
    const GAP_CLOSE_PASSES = 2;
    const BAND_MIN_OVERLAP = 40;
    const BAND_COMPACTION_PASSES = 5;
    const BAND_MOVE_STEP = 2;
    const BAND_MOVE_LIMIT = 160;
    const MAX_PHOTO_SIZE = 72;
    const SPRITE_SCALE = 2;
    const MIN_RENDER_PIXEL_RATIO = 2;
    const MAX_RENDER_PIXEL_RATIO = 2.5;
    const THUMBNAIL_MAX = 320;
    const IMAGE_CONCURRENCY = 5;
    const PROJECTION = { minLng: 73, maxLng: 135.5, minLat: 17.5, maxLat: 54 };
    const BOARD_FRAME = 18;
    const SCENE_BREATHING_ROOM = 42;
    const SCENE_CACHE_SCALE = 2;
    const SCENE_CACHE_PADDING = 64;
    const WALL_SNAPSHOT_SCALE = 2;
    const WALL_SNAPSHOT_MAX_SIDE = 8192;
    const WALL_TILE_WORLD_SIZE = 1024;
    const DRAG_SURFACE_OVERSCAN_X = 480;
    const DRAG_SURFACE_OVERSCAN_Y = 360;
    const DRAG_SURFACE_MAX_SIDE = 8192;
    const SPRITE_SHADOW_PADDING = 18;
    const PAN_MARGIN_X = 360;
    const PAN_MARGIN_Y = 300;
    const SCRAPBOOK_MOTTO_GAP = 72;

    const THEMES = {
        paper: {
            background: '#f2f2f4',
            wallTop: '#ddd9d2',
            wallBottom: '#bdb6ac',
            wallLight: 'rgba(255, 249, 238, 0.34)',
            wallShade: 'rgba(73, 61, 50, 0.16)',
            board: '#b69a78',
            boardDeep: '#8e7358',
            boardWeave: 'rgba(73, 52, 36, 0.09)',
            boardFleck: 'rgba(255, 247, 230, 0.11)',
            frameWood: '#76583f',
            frameLight: '#a1815f',
            frameDeep: '#4f3a2c',
            mapPaper: '#f7f3ea',
            mapPaperEdge: 'rgba(92, 72, 51, 0.23)',
            mapFold: 'rgba(91, 77, 61, 0.17)',
            mapFill: '#f9f8f5',
            mapVisited: accentRgba(0.16),
            mapStroke: 'rgba(53, 53, 60, 0.25)',
            mapLabel: 'rgba(83, 83, 94, 0.66)',
            mapLabelVisited: accentRgba(0.86),
            ink: '#35353c',
            soft: '#686871',
            faint: '#92929b',
            accent: wallAccent,
            accentSoft: accentRgba(0.15),
            line: 'rgba(72, 72, 86, 0.2)',
            lineActive: accentRgba(0.92),
            thread: 'rgba(79, 68, 61, 0.58)',
            frame: '#fbfbfc',
            frameSoft: '#e2e2e8',
            ticket: '#f7f1e7',
            placeholder: '#dedee5',
            shadow: 'rgba(38, 38, 48, 0.16)',
            ambientShadow: 'rgba(61, 47, 35, 0.2)',
            contactShadow: 'rgba(49, 38, 30, 0.24)',
            warmLight: 'rgba(255, 244, 222, 0.32)',
            coolShade: 'rgba(42, 48, 57, 0.12)',
            mottoInk: '#f2e4c8',
            mottoEdge: '#33271d',
            mottoShadow: 'rgba(38, 28, 20, 0.5)'
        },
        scrapbook: {
            background: '#9b8671',
            wallTop: '#b7a48e',
            wallBottom: '#66513f',
            wallLight: 'rgba(255, 244, 220, 0.32)',
            wallShade: 'rgba(45, 30, 20, 0.28)',
            board: '#ded0b8',
            boardDeep: '#bda78a',
            boardWeave: 'rgba(104, 76, 50, 0.1)',
            boardFleck: 'rgba(255, 252, 243, 0.16)',
            frameWood: '#8c6d4f',
            frameLight: '#ba9a72',
            frameDeep: '#573f2c',
            mapPaper: '#f3e7cf',
            mapPaperEdge: 'rgba(103, 76, 50, 0.3)',
            mapFold: 'rgba(108, 82, 56, 0.2)',
            mapFill: '#faf1df',
            mapVisited: accentRgba(0.2),
            mapStroke: 'rgba(76, 62, 48, 0.28)',
            mapLabel: 'rgba(85, 70, 54, 0.7)',
            mapLabelVisited: accentRgba(0.9),
            ink: '#3d342b',
            soft: '#756151',
            faint: '#9a8775',
            accent: wallAccent,
            accentSoft: accentRgba(0.15),
            line: 'rgba(82, 61, 43, 0.22)',
            lineActive: accentRgba(0.9),
            thread: 'rgba(107, 78, 53, 0.52)',
            frame: '#fffaf0',
            frameSoft: '#e8dac5',
            ticket: '#f5e8cf',
            placeholder: '#d8c8ae',
            shadow: 'rgba(69, 47, 30, 0.18)',
            ambientShadow: 'rgba(65, 43, 28, 0.25)',
            contactShadow: 'rgba(51, 33, 21, 0.32)',
            warmLight: 'rgba(255, 236, 199, 0.3)',
            coolShade: 'rgba(65, 46, 36, 0.15)',
            mottoInk: '#6b4b31',
            mottoEdge: '#4d3522',
            mottoShadow: 'rgba(65, 43, 27, 0.25)'
        }
    };

    const state = {
        theme: 'paper',
        sceneStyle: 'classic',
        immersive: false,
        selectedId: '',
        hoveredId: '',
        hoveredFootprint: null,
        hoveredPhoto: null,
        hoveredTicket: null,
        previewPhoto: null,
        previewGroup: null,
        previewPhotos: [],
        previewIndex: 0
    };

    let groups = [];
    let wallData = null;
    let activeYear = 'all';
    let wallYearOpen = false;
    let sceneTickets = [];
    let sceneTicketRects = [];
    let initialized = false;
    let initializationPromise = null;
    let closeTimer = 0;
    const imageItems = new Map();
    const loadQueue = [];
    let loadingImages = 0;
    let queuedImages = 0;
    let finishedImages = 0;
    let failedImages = 0;
    let mapLayers = new Map();
    const materialPatterns = new Map();
    let roomBackdropCache = null;
    let roomBackdropCacheKey = '';
    let sceneBaseCache = null;
    let sceneBaseCacheKey = '';
    let wallSnapshotCache = null;
    let wallSnapshotCacheKey = '';
    let wallSnapshotTimer = 0;
    let wallTileCache = null;
    let wallTileCacheKey = '';
    let dragSnapshotActive = false;
    let dragSnapshotCamera = null;
    let dragSnapshotOverscanX = DRAG_SURFACE_OVERSCAN_X;
    let dragSnapshotOverscanY = DRAG_SURFACE_OVERSCAN_Y;
    let sceneLightingCache = null;
    let sceneLightingCacheKey = '';
    let sceneTicketCache = null;
    let sceneTicketCacheKey = '';
    const pinSprites = new Map();
    let loadPlanReady = false;
    let loadGeneration = 0;
    let sceneReady = false;
    let mapMask = null;
    let scene = null;
    let camera = { x: 0, y: 0, scale: 1 };
    let viewport = { width: window.innerWidth, height: window.innerHeight, dpr: 1 };
    let initialScale = 1;
    let fitScale = 1;
    let dirty = true;
    let drawScheduled = false;
    let layoutTimer = 0;
    let dragging = false;
    let movedDuringDrag = false;
    let activePointer = null;
    let lastPointer = null;
    let drawStart = 0;
    let drawFrames = 0;
    let drawTime = 0;
    let fps = 0;
    let stressUntil = 0;
    let lastDebugUpdate = 0;
    let miniMapView = null;
    let exporting = false;
    let exportTask = 0;
    let exportCancelRequested = false;
    let layoutDirty = false;
    let layoutVersion = 0;
    let layoutMetrics = null;
    let initialFitPending = true;
    let initialFitFrame = 0;
    let cameraBeforeImmersive = null;
    let loadingFinished = false;
    let previewSession = 0;
    let previewOpenComplete = false;
    let previewImageReady = false;
    let previewTransitionAnimation = null;

    function theme() {
        return THEMES[state.theme] || THEMES.paper;
    }

    function sceneStyleIs(name) {
        return state.sceneStyle === name;
    }

    function sceneThemeKey(style) {
        return style === 'classic' ? 'paper' : style;
    }

    function sceneLayoutProfile() {
        if (sceneStyleIs('scrapbook')) {
            return {
                photoSize: 68,
                photoLimit: 90,
                rotationStep: 0.68,
                framePadding: 4
            };
        }
        return {
            photoSize: MAX_PHOTO_SIZE,
            photoLimit: 92,
            rotationStep: 0.36,
            framePadding: PHOTO_FRAME
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function unique(values) {
        const seen = new Set();
        return values.filter(value => {
            if (!value || seen.has(value)) return false;
            seen.add(value);
            return true;
        });
    }

    function formatDate(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return match ? match[1] + '.' + match[2] + '.' + match[3] : '日期未知';
    }

    function footprintYear(footprint) {
        const match = String(footprint && footprint.createTime || '')
            .match(/^(\d{4})-/);
        return match ? match[1] : '';
    }

    function availableYears() {
        return unique((wallData && wallData.footprints || [])
            .map(footprintYear)
            .filter(Boolean))
            .sort((a, b) => Number(b) - Number(a));
    }

    function activeYearLabel() {
        return activeYear === 'all' ? '全部年份' : activeYear + ' 年';
    }

    function updateYearControl() {
        wallYearValue.textContent = activeYearLabel();
        wallYearMenu.querySelectorAll('[role="option"]').forEach(option => {
            option.setAttribute(
                'aria-selected',
                String(option.dataset.year === activeYear)
            );
        });
    }

    function setYearMenuOpen(open, restoreFocus = false) {
        const next = !!open && !wallYearTrigger.disabled &&
            wallYearMenu.children.length > 0;
        wallYearOpen = next;
        wallYearControl.classList.toggle('is-open', next);
        wallYearTrigger.setAttribute('aria-expanded', String(next));
        wallYearMenu.hidden = !next;
        if (next) {
            const selected = wallYearMenu.querySelector(
                '[role="option"][aria-selected="true"]'
            );
            window.requestAnimationFrame(() => {
                (selected || wallYearMenu.firstElementChild)?.focus({
                    preventScroll: true
                });
            });
        } else if (restoreFocus) {
            wallYearTrigger.focus({ preventScroll: true });
        }
    }

    function selectYearOption(option) {
        if (!option || !option.dataset.year) return;
        const year = option.dataset.year;
        setYearMenuOpen(false, true);
        applyYearFilter(year);
    }

    function moveYearMenuFocus(offset) {
        const options = [
            ...wallYearMenu.querySelectorAll('[role="option"]')
        ];
        if (!options.length) return;
        const current = options.indexOf(document.activeElement);
        const next = current < 0
            ? (offset > 0 ? 0 : options.length - 1)
            : (current + offset + options.length) % options.length;
        options[next].focus({ preventScroll: true });
    }

    function populateYearOptions() {
        const fragment = document.createDocumentFragment();
        const years = availableYears();
        if (activeYear !== 'all' && !years.includes(activeYear)) {
            activeYear = 'all';
        }
        ['all', ...years].forEach(year => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'wall-year-option';
            option.dataset.year = year;
            option.setAttribute('role', 'option');
            option.textContent = year === 'all' ? '全部年份' : year + ' 年';
            fragment.append(option);
        });
        wallYearMenu.replaceChildren(fragment);
        updateYearControl();
    }

    function cityKey(footprint) {
        return footprint.cityAdcode ||
            (footprint.province + '/' + footprint.city) ||
            footprint.key;
    }

    function buildGroups() {
        const map = new Map();
        data.footprints.forEach(footprint => {
            const key = cityKey(footprint);
            if (!map.has(key)) {
                map.set(key, {
                    id: key,
                    city: footprint.city || footprint.name || '未命名城市',
                    province: footprint.province || '',
                    provinceAdcode: footprint.provinceAdcode || '',
                    lngTotal: 0,
                    latTotal: 0,
                    coordinateCount: 0,
                    footprints: []
                });
            }
            const group = map.get(key);
            group.lngTotal += footprint.lng;
            group.latTotal += footprint.lat;
            group.coordinateCount++;
            group.footprints.push({
                key: footprint.key,
                name: footprint.name || group.city,
                createTime: footprint.createTime || '',
                description: footprint.description || '',
                photos: unique(footprint.photos || []).map(getImageItem),
                ticketImage: footprint.ticketImage || '',
                ticketTitle: footprint.ticketTitle || '',
                ticketRoute: footprint.ticketRoute || ''
            });
        });

        groups = [...map.values()].map(group => {
            group.lng = group.lngTotal / group.coordinateCount;
            group.lat = group.latTotal / group.coordinateCount;
            group.footprints.sort((a, b) =>
                String(b.createTime).localeCompare(String(a.createTime))
            );
            const allPhotoUrls = group.footprints.flatMap(fp =>
                fp.photos.map(item => item.url)
            );
            group.ticketEntries = [];
            group.tickets = [];
            group.mediaItems = unique([
                ...group.footprints.flatMap(fp => fp.photos)
            ]);
            group.photoCount = allPhotoUrls.length;
            group.footprintCount = group.footprints.length;
            group.latest = group.footprints
                .map(fp => fp.createTime)
                .filter(Boolean)
                .sort()
                .pop() || '';
            group.photoRects = [];
            group.ticketRects = [];
            group.labels = [];
            group.sprite = null;
            group.spriteDirty = true;
            group.ready = false;
            group.side = '';
            group.sideCoord = 0;
            group.nx = 0;
            group.ny = 0;
            return group;
        }).sort((a, b) =>
            String(b.latest).localeCompare(String(a.latest)) ||
            a.city.localeCompare(b.city, 'zh-Hans-CN')
        );

        const ticketSeen = new Set();
        sceneTickets = data.footprints
            .filter(footprint => {
                if (!footprint.ticketImage ||
                    ticketSeen.has(footprint.ticketImage)) {
                    return false;
                }
                ticketSeen.add(footprint.ticketImage);
                return true;
            })
            .sort((a, b) =>
                String(b.createTime).localeCompare(String(a.createTime))
            )
            .map(footprint => {
                return {
                    key: footprint.key,
                    city: footprint.city,
                    name: footprint.name,
                    createTime: footprint.createTime,
                    item: getImageItem(footprint.ticketImage)
                };
            });

        groups.forEach(group => {
            const projected = projectToMap(group.lng, group.lat);
            group.nx = projected.x;
            group.ny = projected.y;
        });
        updateSummary();
    }

    function dataForYear(year) {
        if (!wallData) return null;
        if (year === 'all') return wallData;
        return {
            ...wallData,
            footprints: wallData.footprints.filter(footprint =>
                footprintYear(footprint) === year
            )
        };
    }

    function applyYearFilter(year) {
        const next = year === 'all' ? 'all' : String(year || '');
        if (!next || next === activeYear) return;
        activeYear = next;
        updateYearControl();
        stopPendingImageLoads();
        imageItems.forEach(item => item.groups.clear());
        data = dataForYear(activeYear);
        groups = [];
        sceneTickets = [];
        sceneTicketRects = [];
        state.selectedId = '';
        state.hoveredId = '';
        state.hoveredFootprint = null;
        state.hoveredPhoto = null;
        state.hoveredTicket = null;
        loadPlanReady = false;
        sceneReady = false;
        initialFitPending = false;
        loadingFinished = false;
        layoutDirty = true;
        sceneBaseCache = null;
        sceneBaseCacheKey = '';
        wallSnapshotCache = null;
        wallSnapshotCacheKey = '';
        wallTileCache = null;
        wallTileCacheKey = '';
        sceneTicketCache = null;
        sceneTicketCacheKey = '';
        mapLayers.clear();
        loadingState.classList.remove('is-hidden', 'is-passive');
        setLoadingPhase(
            '正在切换年份',
            activeYearLabel() + '，重新整理城市位置',
            12
        );
        updateInteractionLock(true);
        buildGroups();
        resize();
        buildLoadPlan();
        setFitView(true);
    }

    function getImageItem(url) {
        if (!url) return null;
        if (!imageItems.has(url)) {
            imageItems.set(url, {
                url,
                image: null,
                sprite: null,
                aspect: 4 / 3,
                status: 'idle',
                groups: new Set()
            });
        }
        return imageItems.get(url);
    }

    function projectToMap(lng, lat) {
        return {
            x: clamp((lng - PROJECTION.minLng) /
                (PROJECTION.maxLng - PROJECTION.minLng), 0, 1),
            y: clamp((PROJECTION.maxLat - lat) /
                (PROJECTION.maxLat - PROJECTION.minLat), 0, 1)
        };
    }

    function imageBox(item, maxWidth, maxHeight) {
        const aspect = item && Number.isFinite(item.aspect) ? item.aspect : 4 / 3;
        let width = maxWidth;
        let height = width / aspect;
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspect;
        }
        if (width > maxWidth) width = maxWidth;
        if (height > maxHeight) height = maxHeight;
        return {
            width: Math.max(28, width),
            height: Math.max(28, height)
        };
    }

    function assignPerimeterPositions() {
        const ordered = groups.slice().sort((a, b) => {
            const aAngle = Math.atan2(a.ny - 0.5, a.nx - 0.5);
            const bAngle = Math.atan2(b.ny - 0.5, b.nx - 0.5);
            return aAngle - bAngle || a.id.localeCompare(b.id);
        });
        ordered.forEach((group, index) => {
            group.angle = -Math.PI + (index + 0.5) /
                ordered.length * Math.PI * 2;
            const normalized = (group.angle + Math.PI * 2) %
                (Math.PI * 2);
            if (normalized < Math.PI / 4 ||
                normalized >= Math.PI * 7 / 4) {
                group.side = 'right';
            } else if (normalized < Math.PI * 3 / 4) {
                group.side = 'bottom';
            } else if (normalized < Math.PI * 5 / 4) {
                group.side = 'left';
            } else {
                group.side = 'top';
            }
            // 只作为候选方向的软约束；不再把城市限制在上下左右四个区域。
            group.layoutAnchor = mapBoundaryAlongAngle(group.angle);
        });
    }

    function stableHash(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let index = 0; index < text.length; index++) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function rectDistance(a, b) {
        const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
        const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
        return Math.hypot(dx, dy);
    }

    function rectsOverlapExact(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x &&
            a.y < b.y + b.h && a.y + a.h > b.y;
    }

    function rectsOverlapWithPadding(a, b, padding) {
        const pad = padding || 0;
        return a.x < b.x + b.w + pad &&
            a.x + a.w + pad > b.x &&
            a.y < b.y + b.h + pad &&
            a.y + a.h + pad > b.y;
    }

    function photoVisualRect(rect) {
        const rotation = Number(rect.rotation) || 0;
        if (!rotation) {
            return {
                x: rect.worldX,
                y: rect.worldY,
                w: rect.width,
                h: rect.height
            };
        }
        const angle = rotation * Math.PI / 180;
        const cos = Math.abs(Math.cos(angle));
        const sin = Math.abs(Math.sin(angle));
        const centerX = rect.worldX + rect.width / 2;
        const centerY = rect.worldY + rect.height / 2;
        const width = rect.width * cos + rect.height * sin;
        const height = rect.width * sin + rect.height * cos;
        return {
            x: centerX - width / 2,
            y: centerY - height / 2,
            w: width,
            h: height
        };
    }

    function groupContentRects(group) {
        return [
            ...group.photoRects.map(photoVisualRect),
            ...group.ticketRects.map(rect => ({
                x: rect.worldX,
                y: rect.worldY,
                w: rect.width,
                h: rect.height
            })),
            ...group.labels.map(label => ({
                x: label.worldX,
                y: label.worldY,
                w: label.width,
                h: 18
            })),
            ...(group.titleRect ? [{
                x: group.titleRect.x,
                y: group.titleRect.y,
                w: group.titleRect.w,
                h: group.titleRect.h
            }] : [])
        ].filter(rect => rect &&
            Number.isFinite(rect.x) &&
            Number.isFinite(rect.y) &&
            Number.isFinite(rect.w) &&
            Number.isFinite(rect.h) &&
            rect.w > 0 &&
            rect.h > 0
        );
    }

    function groupCoreRects(group) {
        return [
            ...group.photoRects.map(photoVisualRect),
            ...group.ticketRects.map(rect => ({
                x: rect.worldX,
                y: rect.worldY,
                w: rect.width,
                h: rect.height
            }))
        ];
    }

    function groupBounds(group) {
        const rects = groupContentRects(group);
        if (!rects.length) return null;
        const minX = Math.min(...rects.map(rect => rect.x));
        const minY = Math.min(...rects.map(rect => rect.y));
        const maxX = Math.max(...rects.map(rect => rect.x + rect.w));
        const maxY = Math.max(...rects.map(rect => rect.y + rect.h));
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    // 用闭运算封住组间窄入口，只统计被城市内容包围的空洞。
    function buildGapMetrics() {
        const groupRects = groups.flatMap(group => groupContentRects(group));
        if (!groupRects.length) {
            return {
                boundedVoidArea: 0,
                longestVoidSpan: 0,
                maxVoidAspect: 0,
                voidComponents: [],
                medianGroupGap: 0
            };
        }
        const minX = Math.min(...groupRects.map(rect => rect.x));
        const minY = Math.min(...groupRects.map(rect => rect.y));
        const maxX = Math.max(...groupRects.map(rect => rect.x + rect.w));
        const maxY = Math.max(...groupRects.map(rect => rect.y + rect.h));
        const cell = GAP_GRID_CELL;
        const columns = Math.max(1, Math.ceil((maxX - minX) / cell));
        const rows = Math.max(1, Math.ceil((maxY - minY) / cell));
        const indexOf = (column, row) => row * columns + column;
        const markIndex = (cells, column, row) => {
            if (column < 0 || row < 0 ||
                column >= columns || row >= rows) return;
            cells[indexOf(column, row)] = 1;
        };
        const markRect = (cells, rect) => {
            const startX = clamp(
                Math.floor((rect.x - minX) / cell), 0, columns - 1
            );
            const endX = clamp(
                Math.floor((rect.x + rect.w - 0.001 - minX) / cell),
                0, columns - 1
            );
            const startY = clamp(
                Math.floor((rect.y - minY) / cell), 0, rows - 1
            );
            const endY = clamp(
                Math.floor((rect.y + rect.h - 0.001 - minY) / cell),
                0, rows - 1
            );
            for (let row = startY; row <= endY; row++) {
                for (let column = startX; column <= endX; column++) {
                    cells[indexOf(column, row)] = 1;
                }
            }
        };

        const groupCells = new Uint8Array(columns * rows);
        groupRects.forEach(rect => markRect(groupCells, rect));
        const closedGroupCells = groupCells.slice();
        for (let pass = 0; pass < GAP_CLOSE_PASSES; pass++) {
            const previous = closedGroupCells.slice();
            for (let row = 0; row < rows; row++) {
                for (let column = 0; column < columns; column++) {
                    if (!previous[indexOf(column, row)]) continue;
                    markIndex(closedGroupCells, column - 1, row);
                    markIndex(closedGroupCells, column + 1, row);
                    markIndex(closedGroupCells, column, row - 1);
                    markIndex(closedGroupCells, column, row + 1);
                }
            }
        }

        const mapCells = new Uint8Array(columns * rows);
        const mapCenterX = scene.mapRect.x + MAP_WIDTH / 2;
        const mapCenterY = scene.mapRect.y + MAP_HEIGHT / 2;
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const x = minX + (column + 0.5) * cell - mapCenterX;
                const y = minY + (row + 0.5) * cell - mapCenterY;
                if (maskAlphaAt(x, y) > 24) {
                    mapCells[indexOf(column, row)] = 1;
                }
            }
        }

        const outside = new Uint8Array(columns * rows);
        const queue = new Int32Array(columns * rows);
        let queueStart = 0;
        let queueEnd = 0;
        const addOutside = (column, row) => {
            if (column < 0 || row < 0 ||
                column >= columns || row >= rows) return;
            const index = indexOf(column, row);
            if (outside[index] || closedGroupCells[index] ||
                mapCells[index]) return;
            outside[index] = 1;
            queue[queueEnd++] = index;
        };
        for (let column = 0; column < columns; column++) {
            addOutside(column, 0);
            addOutside(column, rows - 1);
        }
        for (let row = 0; row < rows; row++) {
            addOutside(0, row);
            addOutside(columns - 1, row);
        }
        while (queueStart < queueEnd) {
            const index = queue[queueStart++];
            const row = Math.floor(index / columns);
            const column = index - row * columns;
            addOutside(column - 1, row);
            addOutside(column + 1, row);
            addOutside(column, row - 1);
            addOutside(column, row + 1);
        }

        const visited = new Uint8Array(columns * rows);
        const voidComponents = [];
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const start = indexOf(column, row);
                if (visited[start] || outside[start] ||
                    closedGroupCells[start] || mapCells[start]) continue;
                queueStart = 0;
                queueEnd = 0;
                queue[queueEnd++] = start;
                visited[start] = 1;
                let count = 0;
                let componentMinX = column;
                let componentMaxX = column;
                let componentMinY = row;
                let componentMaxY = row;
                while (queueStart < queueEnd) {
                    const index = queue[queueStart++];
                    const currentRow = Math.floor(index / columns);
                    const currentColumn = index - currentRow * columns;
                    count++;
                    componentMinX = Math.min(componentMinX, currentColumn);
                    componentMaxX = Math.max(componentMaxX, currentColumn);
                    componentMinY = Math.min(componentMinY, currentRow);
                    componentMaxY = Math.max(componentMaxY, currentRow);
                    [
                        [currentColumn - 1, currentRow],
                        [currentColumn + 1, currentRow],
                        [currentColumn, currentRow - 1],
                        [currentColumn, currentRow + 1]
                    ].forEach(([nextColumn, nextRow]) => {
                        if (nextColumn < 0 || nextRow < 0 ||
                            nextColumn >= columns || nextRow >= rows) {
                            return;
                        }
                        const next = indexOf(nextColumn, nextRow);
                        if (visited[next] || outside[next] ||
                            closedGroupCells[next] || mapCells[next]) {
                            return;
                        }
                        visited[next] = 1;
                        queue[queueEnd++] = next;
                    });
                }
                const width = (componentMaxX - componentMinX + 1) * cell;
                const height = (componentMaxY - componentMinY + 1) * cell;
                const area = count * cell * cell;
                if (area < GAP_MIN_COMPONENT_AREA) continue;
                voidComponents.push({
                    x: Math.round(minX + componentMinX * cell),
                    y: Math.round(minY + componentMinY * cell),
                    w: width,
                    h: height,
                    area,
                    span: Math.max(width, height),
                    aspect: Math.max(width, height) /
                        Math.max(1, Math.min(width, height))
                });
            }
        }
        voidComponents.sort((a, b) =>
            b.area - a.area || b.span - a.span
        );

        const pairGaps = [];
        for (let i = 0; i < groups.length; i++) {
            for (let j = i + 1; j < groups.length; j++) {
                pairGaps.push(closestGroupContent(
                    groups[i], groups[j]
                ).gap);
            }
        }
        pairGaps.sort((a, b) => a - b);
        const medianGroupGap = pairGaps.length
            ? pairGaps[Math.floor(pairGaps.length / 2)]
            : 0;
        const clearBandGaps = collectBandGaps(scene.mapRect);
        return {
            boundedVoidArea: voidComponents.reduce((sum, component) =>
                sum + component.area, 0),
            longestVoidSpan: Math.max(0,
                ...voidComponents.map(component => component.span)),
            maxVoidAspect: Math.max(0,
                ...voidComponents.map(component => component.aspect)),
            voidComponents: voidComponents.slice(0, 6),
            medianGroupGap: Math.round(medianGroupGap * 10) / 10,
            boundedBandGapCount: clearBandGaps.length,
            largestBandGap: clearBandGaps.length
                ? Math.round(clearBandGaps[0].gap * 10) / 10 : 0,
            clearBandGaps: clearBandGaps.slice(0, 8).map(band => ({
                axis: band.axis,
                lead: band.leadCity,
                trail: band.trailCity,
                gap: Math.round(band.gap * 10) / 10,
                overlap: Math.round(band.overlap * 10) / 10,
                corridor: band.corridor
            }))
        };
    }

    function labelWidth(text) {
        ctx.save();
        ctx.font = '600 12px ' + fontText;
        const width = ctx.measureText(String(text || '')).width;
        ctx.restore();
        return Math.ceil(width + 12);
    }

    function cityMetaText(group) {
        return (group.province || '未知省份') + '  ｜  ' +
            group.footprintCount + ' 条足迹';
    }

    function cityTitleWidth(group) {
        ctx.save();
        ctx.font = '400 24px "快看世界体", "MiSans", "PingFang SC", sans-serif';
        const cityWidth = ctx.measureText(group.city).width;
        ctx.font = '500 11px ' + fontText;
        const metaWidth = ctx.measureText(cityMetaText(group)).width;
        ctx.restore();
        return Math.ceil(Math.max(24, Math.max(
            cityWidth,
            metaWidth
        ) + 30));
    }

    function buildFootprintCluster(
        group, footprintId, footprint, photos
    ) {
        const gap = 3;
        const area = photos.reduce((sum, photo) =>
            sum + photo.w * photo.h, 0);
        const targetWidth = clamp(
            Math.ceil(Math.sqrt(Math.max(1, area)) * 1.38),
            120,
            300
        );
        let x = 0;
        let y = 0;
        let rowIndex = 0;
        let rowHeight = 0;
        let photoWidth = 0;
        photos.forEach(photo => {
            if (x > 0 && x + photo.w > targetWidth) {
                rowIndex++;
                x = rowIndex % 2 ? 3 : 0;
                y += rowHeight + gap;
                rowHeight = 0;
            }
            photo.lx = x;
            const driftY = ((stableHash(photo.id + '|drift') % 3) - 1) * 1.5;
            photo.ly = y + driftY;
            x += photo.w + gap;
            rowHeight = Math.max(rowHeight, photo.h + Math.max(0, driftY));
            photoWidth = Math.max(photoWidth, x - gap);
        });
        const cluster = {
            id: group.id + '|cluster|' + footprintId,
            groupId: group.id,
            footprintId,
            kind: 'footprint-cluster',
            footprint: footprint.name,
            sequence: photos[0] ? photos[0].sequence : 0,
            photos,
            w: Math.max(1, photoWidth),
            h: Math.max(1, y + rowHeight),
            x: null,
            y: null
        };
        photos.forEach(photo => {
            photo.clusterId = cluster.id;
        });
        return cluster;
    }

    function primaryLayoutCluster(group) {
        return group._layoutClusters
            .slice()
            .sort((a, b) =>
                b.photos.length - a.photos.length ||
                a.sequence - b.sequence ||
                a.id.localeCompare(b.id)
            )[0] || null;
    }

    function buildLayoutModel() {
        const clusters = [];
        const labels = [];
        const entries = [];
        const layoutProfile = sceneLayoutProfile();
        groups.forEach(group => {
            const photoSize = clamp(
                Math.round(layoutProfile.photoSize -
                    Math.log2(Math.max(1, group.photoCount)) * 3),
                52,
                layoutProfile.photoSize
            );
            const title = {
                id: group.id + '|title',
                groupId: group.id,
                kind: 'title',
                title: group.city,
                sequence: 0,
                w: cityTitleWidth(group),
                h: 52,
                x: null,
                y: null
            };
            group._layoutTitle = title;
            group._layoutEntries = [];
            group._layoutItems = [title];
            group._layoutClusters = [];
            group._placedItems = [];
            group._placedClusters = [];
            group._placedPhotos = [];
            group._photoComponents = [];
            group._componentSerial = 0;
            labels.push(title);

            group.footprints.forEach((footprint, footprintIndex) => {
                const footprintId = footprint.key ||
                    group.id + '|footprint|' + footprintIndex;
                const heading = {
                    id: group.id + '|label|' + footprintId,
                    groupId: group.id,
                    footprintId,
                    kind: 'footprint-label',
                    text: footprint.name,
                    sequence: footprintIndex,
                    w: labelWidth(footprint.name),
                    h: 18,
                    x: null,
                    y: null
                };
                const photos = footprint.photos
                    .map((photo, photoIndex) => ({ photo, photoIndex }))
                    .sort((a, b) => {
                        const aBox = imageBox(a.photo, photoSize, photoSize);
                        const bBox = imageBox(b.photo, photoSize, photoSize);
                        return bBox.height - aBox.height ||
                            bBox.width - aBox.width ||
                            String(a.photo && a.photo.url || '')
                                .localeCompare(String(b.photo && b.photo.url || ''));
                    })
                    .map(({ photo, photoIndex }, sortedIndex) => {
                        const photoHash = stableHash(photo.url || '');
                        const sizeFactor = sortedIndex === 0
                            ? 1.18 + (photoHash % 3) * 0.04
                            : 0.88 + (photoHash % 5) * 0.035;
                        const photoLimit = Math.min(
                            layoutProfile.photoLimit,
                            Math.round(photoSize * sizeFactor)
                        );
                        const box = imageBox(
                            photo, photoLimit, photoLimit
                        );
                        return {
                            id: group.id + '|photo|' +
                                stableHash(photo.url) + '|' + photoIndex,
                            groupId: group.id,
                            footprintId,
                            kind: 'photo',
                            item: photo,
                            footprint: footprint.name,
                            createTime: footprint.createTime,
                            sequence: sortedIndex,
                            w: box.width,
                            h: box.height,
                            rotation: (
                                (stableHash(photo.url + '|rotation') % 13) - 6
                            ) * layoutProfile.rotationStep,
                            x: null,
                            y: null
                        };
                    });
                const cluster = buildFootprintCluster(
                    group, footprintId, footprint, photos
                );
                const entry = {
                    group,
                    footprint,
                    footprintId,
                    heading,
                    photos,
                    cluster
                };
                group._layoutEntries.push(entry);
                group._layoutClusters.push(cluster);
                group._layoutItems.push(cluster, heading);
                labels.push(heading);
                clusters.push(cluster);
                entries.push(entry);
            });
        });
        return {
            items: [...clusters, ...labels],
            clusters,
            labels,
            entries
        };
    }

    function buildLayoutGrid(width, height) {
        const originX = -width / 2;
        const originY = -height / 2;
        const columns = Math.ceil(width / LAYOUT_CELL);
        const rows = Math.ceil(height / LAYOUT_CELL);
        const cells = new Uint8Array(columns * rows);
        const cellIndex = (column, row) => row * columns + column;

        function markRect(rect, padding) {
            const pad = Math.max(0, padding || 0);
            const startX = Math.max(0, Math.floor(
                (rect.x - pad - originX) / LAYOUT_CELL
            ));
            const endX = Math.min(columns - 1, Math.floor(
                (rect.x + rect.w + pad - originX) / LAYOUT_CELL
            ));
            const startY = Math.max(0, Math.floor(
                (rect.y - pad - originY) / LAYOUT_CELL
            ));
            const endY = Math.min(rows - 1, Math.floor(
                (rect.y + rect.h + pad - originY) / LAYOUT_CELL
            ));
            for (let row = startY; row <= endY; row++) {
                for (let column = startX; column <= endX; column++) {
                    cells[cellIndex(column, row)] = 1;
                }
            }
        }

        function isFree(rect) {
            if (rect.x < originX || rect.y < originY ||
                rect.x + rect.w > originX + width ||
                rect.y + rect.h > originY + height) return false;
            const startX = Math.max(0, Math.floor(
                (rect.x - originX) / LAYOUT_CELL
            ));
            const endX = Math.min(columns - 1, Math.floor(
                (rect.x + rect.w - 0.001 - originX) / LAYOUT_CELL
            ));
            const startY = Math.max(0, Math.floor(
                (rect.y - originY) / LAYOUT_CELL
            ));
            const endY = Math.min(rows - 1, Math.floor(
                (rect.y + rect.h - 0.001 - originY) / LAYOUT_CELL
            ));
            for (let row = startY; row <= endY; row++) {
                for (let column = startX; column <= endX; column++) {
                    if (cells[cellIndex(column, row)]) return false;
                }
            }
            return true;
        }

        const samples = [-0.34, 0, 0.34];
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const centerX = originX + (column + 0.5) * LAYOUT_CELL;
                const centerY = originY + (row + 0.5) * LAYOUT_CELL;
                let blocked = false;
                for (const offsetY of samples) {
                    for (const offsetX of samples) {
                        if (maskAlphaAt(
                            centerX + offsetX * LAYOUT_CELL,
                            centerY + offsetY * LAYOUT_CELL
                        ) > 24) {
                            blocked = true;
                            break;
                        }
                    }
                    if (blocked) break;
                }
                if (blocked) cells[cellIndex(column, row)] = 1;
            }
        }

        const dilation = Math.ceil(MAP_CLEARANCE / LAYOUT_CELL);
        for (let pass = 0; pass < dilation; pass++) {
            const previous = cells.slice();
            for (let row = 1; row < rows - 1; row++) {
                for (let column = 1; column < columns - 1; column++) {
                    if (!previous[cellIndex(column, row)]) continue;
                    cells[cellIndex(column - 1, row)] = 1;
                    cells[cellIndex(column + 1, row)] = 1;
                    cells[cellIndex(column, row - 1)] = 1;
                    cells[cellIndex(column, row + 1)] = 1;
                }
            }
        }
        const mapCells = cells.slice();

        function isMapFree(rect) {
            if (rect.x < originX || rect.y < originY ||
                rect.x + rect.w > originX + width ||
                rect.y + rect.h > originY + height) return false;
            const startX = Math.max(0, Math.floor(
                (rect.x - originX) / LAYOUT_CELL
            ));
            const endX = Math.min(columns - 1, Math.floor(
                (rect.x + rect.w - 0.001 - originX) / LAYOUT_CELL
            ));
            const startY = Math.max(0, Math.floor(
                (rect.y - originY) / LAYOUT_CELL
            ));
            const endY = Math.min(rows - 1, Math.floor(
                (rect.y + rect.h - 0.001 - originY) / LAYOUT_CELL
            ));
            for (let row = startY; row <= endY; row++) {
                for (let column = startX; column <= endX; column++) {
                    if (mapCells[cellIndex(column, row)]) return false;
                }
            }
            return true;
        }

        return {
            originX, originY, width, height,
            markRect, isFree, isMapFree
        };
    }

    function layoutCandidates(group, item, placed) {
        const candidates = [];
        const seen = new Set();
        const dx = Math.cos(group.angle);
        const dy = Math.sin(group.angle);
        const tx = -dy;
        const ty = dx;
        const anchor = group.layoutAnchor;
        const lateralOffsets = [
            0, 18, -18, 36, -36, 58, -58, 84, -84,
            116, -116, 154, -154, 200, -200, 255, -255,
            320, -320, 400, -400
        ];

        function add(x, y, source) {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const value = {
                x: Math.round(x),
                y: Math.round(y),
                w: item.w,
                h: item.h,
                source
            };
            const key = value.x + ':' + value.y;
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push(value);
        }

        const support = Math.abs(dx) * item.w / 2 +
            Math.abs(dy) * item.h / 2;
        for (let outward = MAP_GAP + support;
            outward <= LAYOUT_RING_LIMIT;
            outward += LAYOUT_RING_STEP) {
            lateralOffsets.forEach(lateral => {
                add(
                    anchor.x + dx * outward + tx * lateral - item.w / 2,
                    anchor.y + dy * outward + ty * lateral - item.h / 2,
                    'anchor'
                );
            });
        }

        placed.forEach(other => {
            add(other.x + other.w + LAYOUT_GAP, other.y, 'contact');
            add(other.x + other.w + LAYOUT_GAP,
                other.y + other.h - item.h, 'contact');
            add(other.x, other.y + other.h + LAYOUT_GAP, 'contact');
            add(other.x + other.w - item.w,
                other.y + other.h + LAYOUT_GAP, 'contact');
            add(other.x - item.w - LAYOUT_GAP, other.y, 'contact');
            add(other.x, other.y - item.h - LAYOUT_GAP, 'contact');
        });
        group._placedItems.forEach(other => {
            [LAYOUT_GAP + 6, LAYOUT_GAP + 14, LAYOUT_GAP + 24].forEach(gap => {
                add(other.x + other.w + gap, other.y, 'own-contact');
                add(other.x, other.y + other.h + gap, 'own-contact');
                add(other.x - item.w - gap, other.y, 'own-contact');
                add(other.x, other.y - item.h - gap, 'own-contact');
            });
        });
        return candidates;
    }

    function addClusterToComponents(group, cluster, rect) {
        const matches = group._photoComponents.filter(component =>
            component.clusters.some(other =>
                rectDistance(rect, other) <= GROUP_COMPONENT_GAP
            )
        );
        let target = matches[0];
        if (!target) {
            target = {
                id: group.id + '|component|' + (++group._componentSerial),
                clusters: []
            };
            group._photoComponents.push(target);
        } else {
            matches.slice(1).forEach(extra => {
                target.clusters.push(...extra.clusters);
                const index = group._photoComponents.indexOf(extra);
                if (index >= 0) group._photoComponents.splice(index, 1);
            });
        }
        target.clusters.push(cluster);
        cluster.componentId = target.id;
    }

    function chooseLayoutSpot(group, item, placed, grid) {
        let best = null;
        let fallback = null;
        const ownItems = group._placedItems;
        layoutCandidates(group, item, placed).forEach(candidate => {
            if (!grid.isFree(candidate)) return;
            const nearestOwn = ownItems.length
                ? Math.min(...ownItems.map(other => rectDistance(candidate, other)))
                : Math.hypot(
                    candidate.x + candidate.w / 2 - group.layoutAnchor.x,
                    candidate.y + candidate.h / 2 - group.layoutAnchor.y
                );
            const anchorDistance = Math.hypot(
                candidate.x + candidate.w / 2 - group.layoutAnchor.x,
                candidate.y + candidate.h / 2 - group.layoutAnchor.y
            );
            const nearbyOwn = ownItems.reduce((count, other) =>
                count + (rectDistance(candidate, other) <= 140 ? 1 : 0), 0);
            const touching = group._placedClusters.reduce((count, other) =>
                count + (rectDistance(candidate, other) <= GROUP_COMPONENT_GAP ? 1 : 0), 0);
            let score = anchorDistance * 0.28 +
                nearestOwn * 0.82 +
                (candidate.source === 'anchor' ? 24 : 0) -
                nearbyOwn * 9 -
                touching * 120;
            if (item.kind === 'footprint-cluster') {
                if (!touching && group._placedClusters.length) {
                    score += group._photoComponents.length >= 2 ? 10000 : 620;
                }
                if (!touching) score += 120;
            } else {
                score = anchorDistance * 0.35 + nearestOwn * 0.78 -
                    nearbyOwn * 15;
            }
            const result = { ...candidate, score };
            if (!fallback || score < fallback.score) fallback = result;
            if (item.kind === 'footprint-cluster' && !touching &&
                group._placedClusters.length &&
                group._photoComponents.length >= 2) return;
            if (!best || score < best.score) best = result;
        });
        return best || fallback;
    }

    function commitLayoutItem(group, item, spot, placed, grid) {
        item.x = spot.x;
        item.y = spot.y;
        item.z = placed.length;
        placed.push(item);
        group._placedItems.push(item);
        grid.markRect(spot, LAYOUT_GAP / 2);
        if (item.kind === 'footprint-cluster') {
            group._placedClusters.push(item);
            item.photos.forEach(photo => group._placedPhotos.push(photo));
            addClusterToComponents(group, item, item);
        }
    }

    function placeLayoutModel(model, grid) {
        const placed = [];
        const ordered = groups.slice().sort((a, b) =>
            a.angle - b.angle || a.id.localeCompare(b.id)
        );

        // 按城市成组放置：主簇后立即放其余簇，优先保持城市内部紧凑。
        ordered.forEach(group => {
            const primary = primaryLayoutCluster(group);
            if (!primary) return;
            const spot = chooseLayoutSpot(group, primary, placed, grid);
            if (!spot) return;
            commitLayoutItem(group, primary, spot, placed, grid);
            group._layoutEntries.forEach(entry => {
                const cluster = entry.cluster;
                if (!Number.isFinite(cluster.x)) {
                    const spot = chooseLayoutSpot(
                        group, cluster, placed, grid
                    );
                    if (spot) {
                        commitLayoutItem(
                            group, cluster, spot, placed, grid
                        );
                    }
                }
            });
        });

        // 名称先参与全局避让，最终再吸附回各自照片簇。
        ordered.forEach(group => {
            if (!Number.isFinite(group._layoutTitle.x)) {
                const titleSpot = chooseLayoutSpot(
                    group, group._layoutTitle, placed, grid
                );
                if (titleSpot) {
                    commitLayoutItem(
                        group, group._layoutTitle, titleSpot, placed, grid
                    );
                }
            }
            group._layoutEntries.forEach(entry => {
                const headingSpot = chooseLayoutSpot(
                    group, entry.heading, placed, grid
                );
                if (headingSpot) {
                    commitLayoutItem(
                        group, entry.heading, headingSpot, placed, grid
                    );
                }
            });
        });
        return placed;
    }

    function groupComponentRect(component, shiftX, shiftY) {
        return {
            x: Math.min(...component.clusters.map(item => item.x)) + shiftX,
            y: Math.min(...component.clusters.map(item => item.y)) + shiftY,
            w: Math.max(...component.clusters.map(item =>
                item.x + item.w)) -
                Math.min(...component.clusters.map(item => item.x)),
            h: Math.max(...component.clusters.map(item =>
                item.y + item.h)) -
                Math.min(...component.clusters.map(item => item.y)),
            count: component.clusters.reduce((sum, cluster) =>
                sum + cluster.photos.length, 0)
        };
    }

    function labelHitsMap(rect, mapRect) {
        const step = 8;
        const right = rect.x + rect.w;
        const bottom = rect.y + rect.h;
        if (maskAlphaAt(
            rect.x + rect.w / 2 - mapRect.x - MAP_WIDTH / 2,
            rect.y + rect.h / 2 - mapRect.y - MAP_HEIGHT / 2
        ) > 24) return true;
        for (let y = rect.y; y <= bottom; y += step) {
            for (let x = rect.x; x <= right; x += step) {
                if (maskAlphaAt(
                    x - mapRect.x - MAP_WIDTH / 2,
                    y - mapRect.y - MAP_HEIGHT / 2
                ) > 24) return true;
            }
            if (maskAlphaAt(
                right - mapRect.x - MAP_WIDTH / 2,
                y - mapRect.y - MAP_HEIGHT / 2
            ) > 24) return true;
        }
        for (let x = rect.x; x <= right; x += step) {
            if (maskAlphaAt(
                x - mapRect.x - MAP_WIDTH / 2,
                bottom - mapRect.y - MAP_HEIGHT / 2
            ) > 24) return true;
        }
        return false;
    }

    function chooseAttachedLabelSpot(
        item, clusters, occupied, reservedLabels, mapRect, preferredEdge,
        groupTerritories
    ) {
        let best = null;
        const seen = new Set();
        const blockers = occupied.concat(reservedLabels);
        const territories = groupTerritories || [];
        const gap = 6;
        const isTitle = item.kind === 'title';
        const territoryPreferenceGap = isTitle ? 30 : LABEL_CLEARANCE;
        const searchLimit = isTitle ? 84 : 96;
        const lateralOffsets = isTitle
            ? [0, 12, -12, 24, -24]
            : [0, 8, -8, 16, -16, 25, -25];
        const widths = [item.w];
        const photoAnchors = isTitle
            ? []
            : clusters.flatMap(cluster =>
                (cluster.photos || []).map(photo => ({
                    x: cluster.x + (photo.lx || 0),
                    y: cluster.y + (photo.ly || 0),
                    w: photo.w,
                    h: photo.h
                }))
            );
        const clusterTop = Math.min(...clusters.map(cluster => cluster.y));
        const clusterBottom = Math.max(...clusters.map(cluster =>
            cluster.y + cluster.h));

        function isFree(candidate) {
            const blockedByContent = blockers.some(rect =>
                rectsOverlapWithPadding(
                    candidate,
                    rect,
                    LABEL_CLEARANCE
                )
            );
            const blockedByTerritory = territories.some(territory =>
                territory.groupId !== item.groupId &&
                rectsOverlapWithPadding(
                    candidate, territory, LABEL_CLEARANCE
                )
            );
            return !blockedByContent && !blockedByTerritory &&
                !labelHitsMap(candidate, mapRect);
        }

        function territoryPenalty(candidate) {
            if (!isTitle) return 0;
            return territories.reduce((sum, territory) => {
                if (territory.groupId === item.groupId) return sum;
                return sum + Math.max(
                    0,
                    territoryPreferenceGap -
                        rectDistance(candidate, territory)
                );
            }, 0);
        }

        function titleLabelPenalty(candidate) {
            if (!isTitle) return 0;
            return blockers.reduce((sum, blocker) => {
                if (blocker.labelKind !== 'city-title') return sum;
                return sum + Math.max(
                    0,
                    CITY_TITLE_CLEARANCE -
                        rectDistance(candidate, blocker)
                ) * 2;
            }, 0);
        }

        function consider(x, y, width, anchor, side) {
            const candidate = {
                x: Math.round(x),
                y: Math.round(y),
                w: width,
                h: item.h
            };
            const key = candidate.x + ':' + candidate.y + ':' + candidate.w;
            if (seen.has(key)) return;
            seen.add(key);
            if (!isFree(candidate)) return;
            const distance = Math.min(...(
                photoAnchors.length ? photoAnchors : clusters
            ).map(anchor => rectDistance(candidate, anchor)));
            const edgePenalty = preferredEdge === 'bottom' &&
                candidate.y < clusters[0].y ? (isTitle ? 4 : 24) :
                preferredEdge === 'top' &&
                    candidate.y > clusters[0].y ? (isTitle ? 4 : 24) : 0;
            const titleSidePenalty = isTitle
                ? (side === preferredEdge ? 0 :
                    side === 'top' || side === 'bottom' ? 4 : 36)
                : 0;
            const sidePenalty = isTitle
                ? titleSidePenalty
                : (side === 'right' ? 0 :
                    side === 'bottom' ? 4 :
                        side === 'top' ? 18 :
                            side === 'left' ? 28 : 0);
            const rowProgress = anchor
                ? clamp(
                    (anchor.y + anchor.h / 2 - clusterTop) /
                        Math.max(1, clusterBottom - clusterTop),
                    0,
                    1
                )
                : 0;
            const distanceCost = isTitle ? distance * 0.55 : distance;
            const score = distanceCost + edgePenalty + sidePenalty -
                rowProgress * 6 + territoryPenalty(candidate) +
                titleLabelPenalty(candidate);
            if (!best || score < best.score) {
                best = {
                    ...candidate,
                    score,
                    distance,
                    overlay: false
                };
            }
        }

        if (photoAnchors.length) {
            widths.forEach(width => {
                photoAnchors.forEach(anchor => {
                    const alignY = [
                        anchor.y,
                        anchor.y + (anchor.h - item.h) / 2,
                        anchor.y + anchor.h - item.h
                    ];
                    const alignX = [
                        anchor.x,
                        anchor.x + (anchor.w - width) / 2,
                        anchor.x + anchor.w - width
                    ];
                    alignY.forEach(y => {
                        consider(
                            anchor.x + anchor.w + gap,
                            y,
                            width,
                            anchor,
                            'right'
                        );
                        consider(
                            anchor.x - width - gap,
                            y,
                            width,
                            anchor,
                            'left'
                        );
                    });
                    alignX.forEach(x => {
                        consider(
                            x,
                            anchor.y - item.h - gap,
                            width,
                            anchor,
                            'top'
                        );
                        consider(
                            x,
                            anchor.y + anchor.h + gap,
                            width,
                            anchor,
                            'bottom'
                        );
                    });
                });
            });
            if (best) return best;
        }

        for (let step = 0; step <= searchLimit; step += 6) {
            widths.forEach(width => {
                clusters.forEach(cluster => {
                    const alignX = [
                        cluster.x,
                        cluster.x + (cluster.w - width) / 2,
                        cluster.x + cluster.w - width
                    ];
                    const alignY = [
                        cluster.y,
                        cluster.y + (cluster.h - item.h) / 2,
                        cluster.y + cluster.h - item.h
                    ];
                    lateralOffsets.forEach(offset => {
                        alignX.forEach(x => {
                            consider(
                                x + offset,
                                cluster.y - item.h - gap - step,
                                width,
                                undefined,
                                isTitle ? 'top' : undefined
                            );
                            consider(
                                x + offset,
                                cluster.y + cluster.h + gap + step,
                                width,
                                undefined,
                                isTitle ? 'bottom' : undefined
                            );
                        });
                        alignY.forEach(y => {
                            consider(
                                cluster.x - width - gap - step,
                                y + offset,
                                width,
                                undefined,
                                isTitle ? 'left' : undefined
                            );
                            consider(
                                cluster.x + cluster.w + gap + step,
                                y + offset,
                                width,
                                undefined,
                                isTitle ? 'right' : undefined
                            );
                        });
                    });
                });
            });
            if (best && step >= best.distance + 18) break;
        }
        if (best) return best;

        if (isTitle) {
            const minX = Math.min(...clusters.map(cluster => cluster.x));
            const minY = Math.min(...clusters.map(cluster => cluster.y));
            const maxX = Math.max(...clusters.map(cluster =>
                cluster.x + cluster.w));
            const maxY = Math.max(...clusters.map(cluster =>
                cluster.y + cluster.h));
            const centerX = (minX + maxX) / 2;
            widths.forEach(width => {
                for (let step = 0; step <= 240; step += 6) {
                    consider(centerX - width / 2,
                        minY - item.h - gap - step, width,
                        undefined, isTitle ? 'top' : undefined);
                    consider(centerX - width / 2,
                        maxY + gap + step, width,
                        undefined, isTitle ? 'bottom' : undefined);
                    consider(minX - width - gap - step,
                        minY + (maxY - minY - item.h) / 2, width,
                        undefined, isTitle ? 'left' : undefined);
                    consider(maxX + gap + step,
                        minY + (maxY - minY - item.h) / 2, width,
                        undefined, isTitle ? 'right' : undefined);
                }
            });
            if (best) return best;
            return null;
        }

        return null;
    }

    function preferredCityTitleEdge(clusters, mapRect) {
        const minX = Math.min(...clusters.map(cluster => cluster.x));
        const minY = Math.min(...clusters.map(cluster => cluster.y));
        const maxX = Math.max(...clusters.map(cluster =>
            cluster.x + cluster.w));
        const maxY = Math.max(...clusters.map(cluster =>
            cluster.y + cluster.h));
        const nx = (minX + maxX) / 2 -
            (mapRect.x + mapRect.width / 2);
        const ny = (minY + maxY) / 2 -
            (mapRect.y + mapRect.height / 2);
        if (ny >= mapRect.height * 0.18) return 'bottom';
        if (ny <= -mapRect.height * 0.18) return 'top';
        if (Math.abs(nx / mapRect.width) >=
            Math.abs(ny / mapRect.height)) {
            return nx >= 0 ? 'right' : 'left';
        }
        return ny >= 0 ? 'bottom' : 'top';
    }

    function refreshGroupBounds(group) {
        const bounds = groupContentRects(group);
        if (!bounds.length) return;
        const oldX = group.x;
        const oldY = group.y;
        const nextX = Math.min(...bounds.map(rect => rect.x));
        const nextY = Math.min(...bounds.map(rect => rect.y));
        const nextWidth = Math.max(...bounds.map(rect =>
            rect.x + rect.w)) - nextX;
        const nextHeight = Math.max(...bounds.map(rect =>
            rect.y + rect.h)) - nextY;
        if (!Number.isFinite(nextX) ||
            !Number.isFinite(nextY) ||
            !Number.isFinite(nextWidth) ||
            !Number.isFinite(nextHeight) ||
            nextWidth <= 0 ||
            nextHeight <= 0) return;
        group.x = nextX;
        group.y = nextY;
        group.width = nextWidth;
        group.height = nextHeight;
        group.photoRects.forEach(rect => {
            rect.lx = rect.worldX - group.x;
            rect.ly = rect.worldY - group.y;
        });
        group.labels.forEach(label => {
            label.x = label.worldX - group.x;
            label.y = label.worldY - group.y;
        });
        group.components.forEach(component => {
            component.lx = component.x - group.x;
            component.ly = component.y - group.y;
        });
        group.footprintClusters.forEach(cluster => {
            cluster.x += oldX - group.x;
            cluster.y += oldY - group.y;
        });
        if (group._layoutTitle &&
            Number.isFinite(group._layoutTitle.labelX)) {
            group.cityLabel = {
                x: group._layoutTitle.labelX - group.x,
                y: group._layoutTitle.labelY - group.y,
                width: group._layoutTitle.labelW,
                overlay: !!group._layoutTitle.labelOverlay
            };
            group.titleRect = {
                x: group._layoutTitle.labelX,
                y: group._layoutTitle.labelY,
                w: group._layoutTitle.labelW,
                h: group._layoutTitle.h
            };
        }
        group.worldRect = {
            x: group.x,
            y: group.y,
            width: group.width,
            height: group.height
        };
    }

    function attachLabelsToClusters(shiftX, shiftY, mapRect) {
        const occupied = groups.flatMap(group =>
            group.photoRects.map(rect => ({
                ...photoVisualRect(rect),
                groupId: group.id
            }))
        );
        const groupTerritories = groups.map(group => {
            const rects = group.photoRects.map(photoVisualRect);
            if (!rects.length) return null;
            const minX = Math.min(...rects.map(rect => rect.x));
            const minY = Math.min(...rects.map(rect => rect.y));
            const maxX = Math.max(...rects.map(rect => rect.x + rect.w));
            const maxY = Math.max(...rects.map(rect => rect.y + rect.h));
            return {
                groupId: group.id,
                x: minX,
                y: minY,
                w: maxX - minX,
                h: maxY - minY
            };
        }).filter(Boolean);
        const reservedLabels = [];

        const titleOrder = groups.slice().sort((a, b) => {
            const aTop = a.photoRects.length
                ? Math.min(...a.photoRects.map(rect =>
                    photoVisualRect(rect).y))
                : Infinity;
            const bTop = b.photoRects.length
                ? Math.min(...b.photoRects.map(rect =>
                    photoVisualRect(rect).y))
                : Infinity;
            return aTop - bTop || a.id.localeCompare(b.id);
        });
        titleOrder.forEach(group => {
            const clusters = group._placedClusters
                .slice()
                .sort((a, b) =>
                    b.photos.length - a.photos.length ||
                    a.sequence - b.sequence ||
                    a.id.localeCompare(b.id)
                )
                .map(cluster => ({
                    ...cluster,
                    x: cluster.x + shiftX,
                    y: cluster.y + shiftY
                }));
            if (!clusters.length) return;
            const preferredTitleEdge =
                preferredCityTitleEdge(clusters, mapRect);
            let spot = chooseAttachedLabelSpot(
                group._layoutTitle,
                clusters,
                occupied,
                reservedLabels,
                mapRect,
                preferredTitleEdge,
                groupTerritories
            );
            if (!spot &&
                Number.isFinite(group._layoutTitle.x) &&
                Number.isFinite(group._layoutTitle.y)) {
                const fallback = {
                    x: group._layoutTitle.x + shiftX,
                    y: group._layoutTitle.y + shiftY,
                    w: group._layoutTitle.w,
                    h: group._layoutTitle.h
                };
                const blocked = occupied.concat(reservedLabels).some(rect =>
                    rectsOverlapWithPadding(
                        fallback,
                        rect,
                        LABEL_CLEARANCE
                    )
                ) || groupTerritories.some(territory =>
                    territory.groupId !== group.id &&
                    rectsOverlapWithPadding(
                        fallback, territory, LABEL_CLEARANCE
                    )
                );
                if (!blocked && !labelHitsMap(fallback, mapRect)) {
                    spot = {
                        ...fallback,
                        score: Infinity,
                        distance: Infinity,
                        overlay: false
                    };
                }
            }
            if (!spot) return;
            group._layoutTitle.labelX = spot.x;
            group._layoutTitle.labelY = spot.y;
            group._layoutTitle.labelW = spot.w;
            group._layoutTitle.labelOverlay = spot.overlay;
            const committedSpot = {
                ...spot,
                labelKind: 'city-title'
            };
            occupied.push(committedSpot);
            reservedLabels.push(committedSpot);
        });

        groups.forEach(group => {
            group._layoutEntries.forEach(entry => {
                if (!Number.isFinite(entry.cluster.x)) return;
                const cluster = {
                    ...entry.cluster,
                    x: entry.cluster.x + shiftX,
                    y: entry.cluster.y + shiftY
                };
                entry.cluster.worldX = cluster.x;
                entry.cluster.worldY = cluster.y;
                let spot = chooseAttachedLabelSpot(
                    entry.heading,
                    [cluster],
                    occupied,
                    reservedLabels,
                    mapRect,
                    'bottom',
                    groupTerritories
                );
                if (!spot &&
                    Number.isFinite(entry.heading.x) &&
                    Number.isFinite(entry.heading.y)) {
                    const fallback = {
                        x: entry.heading.x + shiftX,
                        y: entry.heading.y + shiftY,
                        w: entry.heading.w,
                        h: entry.heading.h
                    };
                    const blocked = occupied.concat(reservedLabels).some(rect =>
                        rectsOverlapWithPadding(
                            fallback,
                            rect,
                            LABEL_CLEARANCE
                        )
                    ) || groupTerritories.some(territory =>
                        territory.groupId !== group.id &&
                        rectsOverlapWithPadding(
                            fallback, territory, LABEL_CLEARANCE
                        )
                    );
                    if (!blocked && !labelHitsMap(fallback, mapRect)) {
                        spot = {
                            ...fallback,
                            score: Infinity,
                            distance: Infinity,
                            overlay: false
                        };
                    }
                }
                if (!spot) return;
                entry.heading.labelX = spot.x;
                entry.heading.labelY = spot.y;
                entry.heading.labelW = spot.w;
                entry.heading.labelOverlay = spot.overlay;
                const committedSpot = {
                    ...spot,
                    labelKind: 'footprint-label'
                };
                occupied.push(committedSpot);
                reservedLabels.push(committedSpot);
            });
        });

        groups.forEach(group => {
            const labels = group._layoutEntries
                .filter(entry => Number.isFinite(entry.heading.labelX))
                .map(entry => ({
                    type: 'footprint',
                    text: entry.footprint.name,
                    footprintId: entry.footprintId,
                    worldX: entry.heading.labelX,
                    worldY: entry.heading.labelY,
                    width: entry.heading.labelW,
                    overlay: !!entry.heading.labelOverlay
                }));
            group.labels = labels;
            group.titleRect = {
                x: group._layoutTitle.labelX,
                y: group._layoutTitle.labelY,
                w: group._layoutTitle.labelW,
                h: group._layoutTitle.h
            };
            refreshGroupBounds(group);
        });
    }

    function groupHitsMap(group, mapRect, offsetX, offsetY) {
        const dx = offsetX || 0;
        const dy = offsetY || 0;
        return groupContentRects(group).some(rect => labelHitsMap({
            x: rect.x + dx,
            y: rect.y + dy,
            w: rect.w,
            h: rect.h
        }, mapRect));
    }

    function rectGapInfo(a, b) {
        const dx = Math.max(0,
            a.x - (b.x + b.w), b.x - (a.x + a.w));
        const dy = Math.max(0,
            a.y - (b.y + b.h), b.y - (a.y + a.h));
        return {
            gap: Math.hypot(dx, dy),
            dx,
            dy,
            overlap: rectsOverlapExact(a, b)
        };
    }

    function closestGroupContent(a, b) {
        let closest = null;
        groupContentRects(a).forEach(aRect => {
            groupContentRects(b).forEach(bRect => {
                const info = rectGapInfo(aRect, bRect);
                if (!closest || info.gap < closest.gap) {
                    closest = {
                        ...info,
                        aRect,
                        bRect
                    };
                }
            });
        });
        return closest || { gap: Infinity };
    }

    function closestGroupCore(a, b) {
        let closest = null;
        groupCoreRects(a).forEach(aRect => {
            groupCoreRects(b).forEach(bRect => {
                const info = rectGapInfo(aRect, bRect);
                if (!closest || info.gap < closest.gap) {
                    closest = {
                        ...info,
                        aRect,
                        bRect
                    };
                }
            });
        });
        return closest || { gap: Infinity };
    }

    function translateGroup(group, dx, dy) {
        if (!dx && !dy) return;
        group.x += dx;
        group.y += dy;
        group.photoRects.forEach(rect => {
            rect.worldX += dx;
            rect.worldY += dy;
        });
        group.labels.forEach(label => {
            label.worldX += dx;
            label.worldY += dy;
        });
        group.components.forEach(component => {
            component.x += dx;
            component.y += dy;
        });
        group.columnCandidates.forEach(candidate => {
            candidate.x += dx;
            candidate.y += dy;
        });
        if (group.titleRect) {
            group.titleRect.x += dx;
            group.titleRect.y += dy;
        }
        if (Number.isFinite(group.lineEndX)) group.lineEndX += dx;
        if (Number.isFinite(group.lineEndY)) group.lineEndY += dy;
        if (Number.isFinite(group.secondaryLineEndX)) {
            group.secondaryLineEndX += dx;
        }
        if (Number.isFinite(group.secondaryLineEndY)) {
            group.secondaryLineEndY += dy;
        }
        group._layoutEntries.forEach(entry => {
            if (Number.isFinite(entry.cluster.worldX)) {
                entry.cluster.worldX += dx;
                entry.cluster.worldY += dy;
            }
            if (Number.isFinite(entry.heading.labelX)) {
                entry.heading.labelX += dx;
                entry.heading.labelY += dy;
            }
        });
        if (group._layoutTitle &&
            Number.isFinite(group._layoutTitle.labelX)) {
            group._layoutTitle.labelX += dx;
            group._layoutTitle.labelY += dy;
        }
        group.worldRect = {
            x: group.x,
            y: group.y,
            width: group.width,
            height: group.height
        };
    }

    function shiftedGroupContent(group, dx, dy) {
        return groupContentRects(group).map(rect => ({
            x: rect.x + dx,
            y: rect.y + dy,
            w: rect.w,
            h: rect.h
        }));
    }

    function rectSetGap(aRects, bRects) {
        let closest = Infinity;
        aRects.forEach(a => {
            bRects.forEach(b => {
                closest = Math.min(closest, rectDistance(a, b));
            });
        });
        return closest;
    }

    function canMoveGroup(group, dx, dy, excluded, mapRect) {
        if (groupHitsMap(group, mapRect, dx, dy)) return false;
        const proposed = shiftedGroupContent(group, dx, dy);
        const bounds = groupBounds(group);
        const proposedBounds = bounds ? {
            x: bounds.x + dx,
            y: bounds.y + dy,
            w: bounds.w,
            h: bounds.h
        } : null;
        return groups.every(other => {
            if (other === group || excluded.has(other)) return true;
            if (proposedBounds) {
                const otherBounds = groupBounds(other);
                if (!otherBounds ||
                    rectDistance(proposedBounds, otherBounds) >=
                        LOCAL_GROUP_GAP) {
                    return true;
                }
            }
            return rectSetGap(proposed, groupContentRects(other)) >=
                LOCAL_GROUP_GAP;
        });
    }

    function compactAdjacentGroups(mapRect) {
        const centerX = mapRect.x + MAP_WIDTH / 2;
        const centerY = mapRect.y + MAP_HEIGHT / 2;
        const ordered = groups.slice().sort((a, b) => {
            const aAngle = Math.atan2(
                a.y + a.height / 2 - centerY,
                a.x + a.width / 2 - centerX
            );
            const bAngle = Math.atan2(
                b.y + b.height / 2 - centerY,
                b.x + b.width / 2 - centerX
            );
            return aAngle - bAngle || a.id.localeCompare(b.id);
        });
        for (let pass = 0; pass < ADJACENT_GROUP_PASSES; pass++) {
            let changed = false;
            for (let index = 0; index < ordered.length; index++) {
                const a = ordered[index];
                const b = ordered[(index + 1) % ordered.length];
                const gap = closestGroupContent(a, b).gap;
                if (!Number.isFinite(gap) ||
                    gap <= ADJACENT_GROUP_TARGET_GAP + 2) continue;
                const aCenterX = a.x + a.width / 2;
                const aCenterY = a.y + a.height / 2;
                const bCenterX = b.x + b.width / 2;
                const bCenterY = b.y + b.height / 2;
                const length = Math.hypot(
                    bCenterX - aCenterX,
                    bCenterY - aCenterY
                );
                if (length < 1) continue;
                const directionX = (bCenterX - aCenterX) / length;
                const directionY = (bCenterY - aCenterY) / length;
                const step = Math.min(
                    ADJACENT_GROUP_MAX_STEP,
                    (gap - ADJACENT_GROUP_TARGET_GAP) / 2
                );
                const excluded = new Set([a, b]);
                const aDx = directionX * step;
                const aDy = directionY * step;
                const bDx = -directionX * step;
                const bDy = -directionY * step;
                const proposedGap = rectSetGap(
                    shiftedGroupContent(a, aDx, aDy),
                    shiftedGroupContent(b, bDx, bDy)
                );
                if (step > 0.5 &&
                    proposedGap >= LOCAL_GROUP_GAP &&
                    canMoveGroup(a, aDx, aDy, excluded, mapRect) &&
                    canMoveGroup(b, bDx, bDy, excluded, mapRect)) {
                    translateGroup(a, aDx, aDy);
                    translateGroup(b, bDx, bDy);
                    changed = true;
                    continue;
                }

                const singleStep = Math.min(
                    ADJACENT_GROUP_MAX_STEP * 2,
                    gap - ADJACENT_GROUP_TARGET_GAP
                );
                const singleExcluded = new Set([b]);
                if (canMoveGroup(
                    a,
                    directionX * singleStep,
                    directionY * singleStep,
                    singleExcluded,
                    mapRect
                )) {
                    translateGroup(
                        a,
                        directionX * singleStep,
                        directionY * singleStep
                    );
                    changed = true;
                } else {
                    const reverseExcluded = new Set([a]);
                    if (canMoveGroup(
                        b,
                        -directionX * singleStep,
                        -directionY * singleStep,
                        reverseExcluded,
                        mapRect
                    )) {
                        translateGroup(
                            b,
                            -directionX * singleStep,
                            -directionY * singleStep
                        );
                        changed = true;
                    }
                }
            }
            if (!changed) break;
        }
    }

    function pullGroupsTowardMap(mapRect) {
        const centerX = mapRect.x + MAP_WIDTH / 2;
        const centerY = mapRect.y + MAP_HEIGHT / 2;
        groups
            .slice()
            .sort((a, b) =>
                Math.hypot(
                    a.x + a.width / 2 - centerX,
                    a.y + a.height / 2 - centerY
                ) -
                Math.hypot(
                    b.x + b.width / 2 - centerX,
                    b.y + b.height / 2 - centerY
                )
            )
            .forEach(group => {
                const dx = centerX - (group.x + group.width / 2);
                const dy = centerY - (group.y + group.height / 2);
                const length = Math.hypot(dx, dy);
                if (length < 1) return;
                const directionX = dx / length;
                const directionY = dy / length;
                let chosen = null;
                for (let distance = MAP_PULL_STEP;
                    distance <= MAP_PULL_LIMIT;
                    distance += MAP_PULL_STEP) {
                    const moveX = directionX * distance;
                    const moveY = directionY * distance;
                    if (!canMoveGroup(
                        group, moveX, moveY, new Set(), mapRect
                    )) break;
                    chosen = { x: moveX, y: moveY };
                }
                if (chosen) {
                    translateGroup(group, chosen.x, chosen.y);
                }
            });
    }

    function separateGroupsFromMap(mapRect) {
        const mapCenterX = mapRect.x + MAP_WIDTH / 2;
        const mapCenterY = mapRect.y + MAP_HEIGHT / 2;
        groups.forEach(group => {
            if (!groupHitsMap(group, mapRect, 0, 0)) return;
            const outwardX = group.x + group.width / 2 - mapCenterX;
            const outwardY = group.y + group.height / 2 - mapCenterY;
            const length = Math.hypot(outwardX, outwardY);
            const directions = [];
            if (length > 0.001) {
                directions.push({
                    x: outwardX / length,
                    y: outwardY / length
                });
            }
            [
                [1, 0], [-1, 0], [0, 1], [0, -1],
                [1, 1], [-1, 1], [1, -1], [-1, -1]
            ].forEach(([x, y]) => {
                const norm = Math.hypot(x, y);
                directions.push({ x: x / norm, y: y / norm });
            });
            for (const direction of directions) {
                let moved = false;
                for (let distance = 16; distance <= 192; distance += 16) {
                    const dx = direction.x * distance;
                    const dy = direction.y * distance;
                    if (!canMoveGroup(
                        group, dx, dy, new Set(), mapRect
                    )) continue;
                    translateGroup(group, dx, dy);
                    moved = true;
                    break;
                }
                if (moved) break;
            }
        });
    }

    function groupHitsRect(group, rect, offsetX, offsetY, padding) {
        const dx = offsetX || 0;
        const dy = offsetY || 0;
        return groupContentRects(group).some(content => {
            const shifted = {
                x: content.x + dx,
                y: content.y + dy,
                w: content.w,
                h: content.h
            };
            return rectsOverlapWithPadding(
                shifted,
                rect,
                padding || 0
            );
        });
    }

    function sceneHeadingWorldRect() {
        const metrics = sceneHeadingMetrics();
        if (!metrics || !scene || !scene.boardRect) return null;
        const board = scene.boardRect;
        return {
            x: board.x + BOARD_FRAME + 26,
            y: board.y + BOARD_FRAME + 26,
            w: metrics.width,
            h: metrics.height
        };
    }

    function expandSceneForHeading() {
        const heading = sceneHeadingWorldRect();
        if (!heading) return;
        const clearance = 18;
        const topEdges = groups.map(group => {
            const bounds = groupBounds(group);
            if (!bounds ||
                bounds.x + bounds.w <= heading.x - clearance ||
                bounds.x >= heading.x + heading.w + clearance) {
                return null;
            }
            return bounds.y;
        }).filter(Number.isFinite);
        if (!topEdges.length) return;
        const extension = Math.ceil((
            heading.y + heading.h + clearance - Math.min(...topEdges)
        ) / 8) * 8;
        if (extension <= 0) return;
        scene.topExtension = extension;
        refreshBoardBounds();
    }

    function localMoveDirections(group, other, mapRect) {
        const directions = [];
        const seen = new Set();
        const groupCenterX = group.x + group.width / 2;
        const groupCenterY = group.y + group.height / 2;
        const otherCenterX = other.x + other.width / 2;
        const otherCenterY = other.y + other.height / 2;
        const mapCenterX = mapRect.x + MAP_WIDTH / 2;
        const mapCenterY = mapRect.y + MAP_HEIGHT / 2;

        function add(x, y, priority) {
            const length = Math.hypot(x, y);
            if (length < 0.001) return;
            const dx = x / length;
            const dy = y / length;
            const key = dx.toFixed(4) + ':' + dy.toFixed(4);
            if (seen.has(key)) return;
            seen.add(key);
            directions.push({ x: dx, y: dy, priority });
        }

        add(groupCenterX - otherCenterX,
            groupCenterY - otherCenterY, 0);
        add(groupCenterX - mapCenterX,
            groupCenterY - mapCenterY, 1);
        add(1, 0, 2);
        add(-1, 0, 2);
        add(0, 1, 2);
        add(0, -1, 2);
        return directions;
    }

    function localMoveCandidate(
        group, other, dx, dy, baselineGaps, mapRect
    ) {
        translateGroup(group, dx, dy);
        const pairGap = closestGroupCore(group, other).gap;
        const mapHit = groupHitsMap(group, mapRect, 0, 0);
        const newViolations = groups.reduce((count, candidate, index) => {
            if (candidate === group || candidate === other) return count;
            const previous = baselineGaps[index];
            const current = closestGroupCore(group, candidate).gap;
            return count + (
                previous >= LOCAL_GROUP_GAP - 0.001 &&
                current < LOCAL_GROUP_GAP - 0.001 ? 1 : 0
            );
        }, 0);
        translateGroup(group, -dx, -dy);
        return {
            group,
            other,
            dx,
            dy,
            pairGap,
            mapHit,
            newViolations
        };
    }

    function resolveLocalGroupConflicts(mapRect) {
        const ordered = groups.slice().sort((a, b) =>
            a.angle - b.angle || a.id.localeCompare(b.id)
        );
        for (let iteration = 0;
            iteration < Math.min(12, ordered.length);
            iteration++) {
            const conflicts = [];
            for (let i = 0; i < ordered.length; i++) {
                for (let j = i + 1; j < ordered.length; j++) {
                    const info = closestGroupCore(
                        ordered[i], ordered[j]
                    );
                    if (info.gap < LOCAL_GROUP_GAP - 0.001) {
                        conflicts.push({
                            a: ordered[i],
                            b: ordered[j],
                            gap: info.gap,
                            index: i * ordered.length + j
                        });
                    }
                }
            }
            if (!conflicts.length) break;
            conflicts.sort((a, b) =>
                a.gap - b.gap || a.index - b.index
            );
            const conflict = conflicts[0];
            const required = LOCAL_GROUP_GAP -
                conflict.gap + 0.25;
            const candidates = [];
            [conflict.a, conflict.b].forEach((group, moveIndex) => {
                const other = group === conflict.a
                    ? conflict.b : conflict.a;
                const baselineGaps = groups.map(candidate =>
                    candidate === group || candidate === other
                        ? null
                        : closestGroupCore(group, candidate).gap
                );
                const directions = localMoveDirections(
                    group, other, mapRect
                );
                directions.forEach(direction => {
                    let solved = false;
                    for (let distance = Math.max(0.5, required);
                        distance <= 18 && !solved;
                        distance += 0.5) {
                        const candidate = localMoveCandidate(
                            group,
                            other,
                            direction.x * distance,
                            direction.y * distance,
                            baselineGaps,
                            mapRect
                        );
                        if (candidate.mapHit ||
                            candidate.pairGap <
                                LOCAL_GROUP_GAP - 0.001) {
                            continue;
                        }
                        candidate.score =
                            candidate.newViolations * 1000 +
                            distance +
                            direction.priority * 0.01 +
                            moveIndex * 0.001;
                        candidates.push(candidate);
                        if (candidate.newViolations === 0) {
                            solved = true;
                        }
                    }
                });
            });
            if (!candidates.length) break;
            candidates.sort((a, b) =>
                a.score - b.score ||
                a.dx - b.dx ||
                a.dy - b.dy
            );
            const chosen = candidates[0];
            translateGroup(chosen.group, chosen.dx, chosen.dy);
        }
    }

    function corridorHasObstacle(corridor, mapRect) {
        if (corridor.w < 1 || corridor.h < 1) return true;
        if (labelHitsMap(corridor, mapRect)) return true;
        return groups.some(group =>
            groupContentRects(group).some(rect =>
                rectsOverlapExact(corridor, rect)
            )
        );
    }

    // 只保留投影重叠、且中间没有地图或其他城市内容的真实空带。
    function collectBandGaps(mapRect) {
        const items = groups.map(group => ({
            group,
            bounds: groupBounds(group)
        })).filter(item => item.bounds);
        const bandGaps = [];
        items.forEach((a, index) => {
            items.slice(index + 1).forEach(b => {
                const aRect = a.bounds;
                const bRect = b.bounds;
                const overlapX = Math.min(
                    aRect.x + aRect.w, bRect.x + bRect.w
                ) - Math.max(aRect.x, bRect.x);
                const overlapY = Math.min(
                    aRect.y + aRect.h, bRect.y + bRect.h
                ) - Math.max(aRect.y, bRect.y);
                if (overlapX >= BAND_MIN_OVERLAP) {
                    const upper = aRect.y <= bRect.y ? a : b;
                    const lower = upper === a ? b : a;
                    const gap = lower.bounds.y -
                        (upper.bounds.y + upper.bounds.h);
                    if (gap > ADJACENT_GROUP_TARGET_GAP) {
                        const corridor = {
                            x: Math.max(aRect.x, bRect.x),
                            y: upper.bounds.y + upper.bounds.h,
                            w: overlapX,
                            h: gap
                        };
                        if (upper.group !== lower.group &&
                            !corridorHasObstacle(corridor, mapRect)) {
                            bandGaps.push({
                                axis: 'y',
                                sign: 1,
                                lead: upper.group,
                                trail: lower.group,
                                leadCity: upper.group.city,
                                trailCity: lower.group.city,
                                gap,
                                overlap: overlapX,
                                corridor
                            });
                        }
                    }
                }
                if (overlapY >= BAND_MIN_OVERLAP) {
                    const left = aRect.x <= bRect.x ? a : b;
                    const right = left === a ? b : a;
                    const gap = right.bounds.x -
                        (left.bounds.x + left.bounds.w);
                    if (gap > ADJACENT_GROUP_TARGET_GAP) {
                        const corridor = {
                            x: left.bounds.x + left.bounds.w,
                            y: Math.max(aRect.y, bRect.y),
                            w: gap,
                            h: overlapY
                        };
                        if (left.group !== right.group &&
                            !corridorHasObstacle(corridor, mapRect)) {
                            bandGaps.push({
                                axis: 'x',
                                sign: 1,
                                lead: left.group,
                                trail: right.group,
                                leadCity: left.group.city,
                                trailCity: right.group.city,
                                gap,
                                overlap: overlapY,
                                corridor
                            });
                        }
                    }
                }
            });
        });
        return bandGaps.sort((a, b) =>
            (b.gap - ADJACENT_GROUP_TARGET_GAP) * b.overlap -
                (a.gap - ADJACENT_GROUP_TARGET_GAP) * a.overlap ||
            b.gap - a.gap
        );
    }

    function layoutBandEnergy(bandGaps) {
        return bandGaps.reduce((sum, band) => {
            const excess = Math.max(
                0, band.gap - ADJACENT_GROUP_TARGET_GAP
            );
            return sum + excess * Math.sqrt(Math.max(1, band.overlap));
        }, 0);
    }

    function layoutOuterArea(mapRect) {
        let minX = mapRect.x;
        let minY = mapRect.y;
        let maxX = mapRect.x + mapRect.width;
        let maxY = mapRect.y + mapRect.height;
        groups.forEach(group => {
            const bounds = groupBounds(group);
            if (!bounds) return;
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.w);
            maxY = Math.max(maxY, bounds.y + bounds.h);
        });
        return Math.max(1, maxX - minX) * Math.max(1, maxY - minY);
    }

    function layoutCompactionCost(mapRect, knownBandGaps) {
        const centerX = mapRect.x + mapRect.width / 2;
        const centerY = mapRect.y + mapRect.height / 2;
        const bandGaps = knownBandGaps || collectBandGaps(mapRect);
        const anchorPenalty = groups.reduce((sum, group) => {
            const bounds = groupBounds(group);
            if (!bounds) return sum;
            const anchorX = centerX + group.layoutAnchor.x;
            const anchorY = centerY + group.layoutAnchor.y;
            const centerDistance = Math.hypot(
                bounds.x + bounds.w / 2 - anchorX,
                bounds.y + bounds.h / 2 - anchorY
            );
            const actualAngle = Math.atan2(
                bounds.y + bounds.h / 2 - centerY,
                bounds.x + bounds.w / 2 - centerX
            );
            const angleDelta = Math.atan2(
                Math.sin(actualAngle - group.angle),
                Math.cos(actualAngle - group.angle)
            );
            return sum + centerDistance * 0.08 +
                angleDelta * angleDelta * 180;
        }, 0);
        return layoutBandEnergy(bandGaps) * 12 +
            layoutOuterArea(mapRect) / 700 +
            anchorPenalty;
    }

    function safeAxisMove(
        group, axis, direction, limit, mapRect, excluded
    ) {
        const maxDistance = Math.max(
            0, Math.min(BAND_MOVE_LIMIT, limit)
        );
        const maxSteps = Math.floor(maxDistance / BAND_MOVE_STEP);
        if (maxSteps < 1) return 0;
        const isSafe = steps => {
            const distance = steps * BAND_MOVE_STEP;
            const dx = axis === 'x' ? direction * distance : 0;
            const dy = axis === 'y' ? direction * distance : 0;
            return canMoveGroup(
                group, dx, dy, excluded || new Set(), mapRect
            );
        };
        if (!isSafe(1)) return 0;
        if (isSafe(maxSteps)) return maxSteps * BAND_MOVE_STEP;
        let low = 1;
        let high = maxSteps;
        while (low + 1 < high) {
            const middle = Math.floor((low + high) / 2);
            if (isSafe(middle)) low = middle;
            else high = middle;
        }
        return low * BAND_MOVE_STEP;
    }

    function evaluateBandMove(
        band, leadMove, trailMove, mapRect
    ) {
        const leadDx = band.axis === 'x'
            ? band.sign * leadMove : 0;
        const leadDy = band.axis === 'y'
            ? band.sign * leadMove : 0;
        const trailDx = band.axis === 'x'
            ? -band.sign * trailMove : 0;
        const trailDy = band.axis === 'y'
            ? -band.sign * trailMove : 0;
        translateGroup(band.lead, leadDx, leadDy);
        translateGroup(band.trail, trailDx, trailDy);
        const exactGap = closestGroupContent(
            band.lead, band.trail
        ).gap;
        const valid = exactGap >= LOCAL_GROUP_GAP - 0.001 &&
            !groupHitsMap(band.lead, mapRect, 0, 0) &&
            !groupHitsMap(band.trail, mapRect, 0, 0);
        const gain = Math.max(0, band.gap - exactGap) *
            Math.sqrt(Math.max(1, band.overlap));
        const score = valid
            ? gain - (leadMove + trailMove) * 0.4
            : -Infinity;
        translateGroup(band.lead, -leadDx, -leadDy);
        translateGroup(band.trail, -trailDx, -trailDy);
        return {
            leadMove,
            trailMove,
            exactGap,
            valid,
            score
        };
    }

    // 空带两侧都可移动，避免只向地图收缩时被地图边界卡住。
    function compactBandGaps(mapRect) {
        for (let pass = 0;
            pass < BAND_COMPACTION_PASSES;
            pass++) {
            const bandGaps = collectBandGaps(mapRect);
            if (!bandGaps.length) break;
            const currentCost = layoutCompactionCost(
                mapRect, bandGaps
            );
            let chosen = null;
            bandGaps.slice(0, 12).forEach(band => {
                const budget = Math.min(
                    BAND_MOVE_LIMIT,
                    band.gap - ADJACENT_GROUP_TARGET_GAP
                );
                const leadSpace = safeAxisMove(
                    band.lead,
                    band.axis,
                    band.sign,
                    budget,
                    mapRect,
                    new Set()
                );
                const trailSpace = safeAxisMove(
                    band.trail,
                    band.axis,
                    -band.sign,
                    budget,
                    mapRect,
                    new Set()
                );
                const candidates = [
                    [leadSpace, 0],
                    [0, trailSpace]
                ];
                const trailShare = Math.max(
                    0, Math.floor(trailSpace / 2 / BAND_MOVE_STEP) *
                        BAND_MOVE_STEP
                );
                if (trailShare > 0) {
                    translateGroup(
                        band.trail,
                        band.axis === 'x'
                            ? -band.sign * trailShare : 0,
                        band.axis === 'y'
                            ? -band.sign * trailShare : 0
                    );
                    const remainingLead = safeAxisMove(
                        band.lead,
                        band.axis,
                        band.sign,
                        budget - trailShare,
                        mapRect,
                        new Set()
                    );
                    translateGroup(
                        band.trail,
                        band.axis === 'x'
                            ? band.sign * trailShare : 0,
                        band.axis === 'y'
                            ? band.sign * trailShare : 0
                    );
                    if (remainingLead > 0) {
                        candidates.push([remainingLead, trailShare]);
                    }
                }
                candidates.forEach(([leadMove, trailMove]) => {
                    if (leadMove + trailMove < BAND_MOVE_STEP) return;
                    const result = evaluateBandMove(
                        band, leadMove, trailMove, mapRect
                    );
                    if (!result.valid || !Number.isFinite(result.score)) {
                        return;
                    }
                    if (result.score <= 0) return;
                    if (!chosen || result.score > chosen.score) {
                        chosen = { ...result, band };
                    }
                });
            });
            if (!chosen) break;
            translateGroup(
                chosen.band.lead,
                chosen.band.axis === 'x'
                    ? chosen.band.sign * chosen.leadMove : 0,
                chosen.band.axis === 'y'
                    ? chosen.band.sign * chosen.leadMove : 0
            );
            translateGroup(
                chosen.band.trail,
                chosen.band.axis === 'x'
                    ? -chosen.band.sign * chosen.trailMove : 0,
                chosen.band.axis === 'y'
                    ? -chosen.band.sign * chosen.trailMove : 0
            );
            const nextCost = layoutCompactionCost(mapRect);
            if (nextCost >= currentCost - 0.5) {
                translateGroup(
                    chosen.band.lead,
                    chosen.band.axis === 'x'
                        ? -chosen.band.sign * chosen.leadMove : 0,
                    chosen.band.axis === 'y'
                        ? -chosen.band.sign * chosen.leadMove : 0
                );
                translateGroup(
                    chosen.band.trail,
                    chosen.band.axis === 'x'
                        ? chosen.band.sign * chosen.trailMove : 0,
                    chosen.band.axis === 'y'
                        ? chosen.band.sign * chosen.trailMove : 0
                );
                break;
            }
        }
    }

    function cityTitleRects() {
        return groups
            .map(group => group.titleRect ? {
                group,
                rect: group.titleRect
            } : null)
            .filter(Boolean);
    }

    function cityTitlePairInfo(a, b) {
        const xOverlap = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) -
            Math.max(a.rect.x, b.rect.x);
        const yOverlap = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) -
            Math.max(a.rect.y, b.rect.y);
        if (xOverlap > 0) {
            const upper = a.rect.y <= b.rect.y ? a : b;
            const lower = upper === a ? b : a;
            return {
                axis: 'y',
                gap: Math.max(
                    0,
                    lower.rect.y - (upper.rect.y + upper.rect.h)
                ),
                upper,
                lower
            };
        }
        if (yOverlap > 0) {
            const left = a.rect.x <= b.rect.x ? a : b;
            const right = left === a ? b : a;
            return {
                axis: 'x',
                gap: Math.max(
                    0,
                    right.rect.x - (left.rect.x + left.rect.w)
                ),
                left,
                right
            };
        }
        return null;
    }

    function cityTitleSeparationCost() {
        const titles = cityTitleRects();
        let cost = 0;
        for (let i = 0; i < titles.length; i++) {
            for (let j = i + 1; j < titles.length; j++) {
                const info = cityTitlePairInfo(titles[i], titles[j]);
                if (!info) continue;
                cost += Math.pow(
                    Math.max(0, CITY_TITLE_CLEARANCE - info.gap),
                    2
                );
            }
        }
        return cost;
    }

    function separateCityTitles(mapRect) {
        for (let pass = 0; pass < 4; pass++) {
            const titles = cityTitleRects();
            const pairs = [];
            for (let i = 0; i < titles.length; i++) {
                for (let j = i + 1; j < titles.length; j++) {
                    const info = cityTitlePairInfo(titles[i], titles[j]);
                    if (!info ||
                        info.gap >= CITY_TITLE_CLEARANCE) continue;
                    pairs.push(info);
                }
            }
            if (!pairs.length) break;
            pairs.sort((a, b) => a.gap - b.gap);
            const currentCost = cityTitleSeparationCost();
            let best = null;
            pairs.slice(0, 6).forEach(pair => {
                const amount = Math.min(
                    48,
                    CITY_TITLE_CLEARANCE - pair.gap + 2
                );
                const candidates = pair.axis === 'y'
                    ? [
                        [pair.upper.group, 'y', -1],
                        [pair.lower.group, 'y', 1]
                    ]
                    : [
                        [pair.left.group, 'x', -1],
                        [pair.right.group, 'x', 1]
                    ];
                candidates.forEach(([group, axis, direction]) => {
                    const distance = safeAxisMove(
                        group,
                        axis,
                        direction,
                        amount,
                        mapRect,
                        new Set()
                    );
                    if (distance < BAND_MOVE_STEP) return;
                    const dx = axis === 'x' ? direction * distance : 0;
                    const dy = axis === 'y' ? direction * distance : 0;
                    translateGroup(group, dx, dy);
                    const cost = cityTitleSeparationCost() +
                        layoutOuterArea(mapRect) / 10000;
                    translateGroup(group, -dx, -dy);
                    if (!best || cost < best.cost) {
                        best = {
                            group,
                            dx,
                            dy,
                            cost
                        };
                    }
                });
            });
            if (!best || best.cost >= currentCost - 0.5) break;
            translateGroup(best.group, best.dx, best.dy);
        }
    }

    function reattachCityTitles(mapRect) {
        const ordered = groups.slice().sort((a, b) => {
            const aTop = a.photoRects.length
                ? Math.min(...a.photoRects.map(rect =>
                    photoVisualRect(rect).y))
                : Infinity;
            const bTop = b.photoRects.length
                ? Math.min(...b.photoRects.map(rect =>
                    photoVisualRect(rect).y))
                : Infinity;
            return aTop - bTop || a.id.localeCompare(b.id);
        });
        ordered.forEach(group => {
            if (!group.photoRects.length) return;
            const clusters = group._layoutEntries
                .filter(entry => Number.isFinite(entry.cluster.worldX))
                .map(entry => ({
                    ...entry.cluster,
                    x: entry.cluster.worldX,
                    y: entry.cluster.worldY
                }));
            if (!clusters.length) return;
            const photoBlockers = groups.flatMap(item =>
                item.photoRects.map(rect => ({
                    ...photoVisualRect(rect),
                    groupId: item.id
                }))
            );
            const labels = groups.flatMap(item => [
                ...item.labels.map(label => ({
                    x: label.worldX,
                    y: label.worldY,
                    w: label.width,
                    h: 18,
                    labelKind: 'footprint-label'
                })),
                ...(item !== group && item.titleRect ? [{
                    ...item.titleRect,
                    labelKind: 'city-title'
                }] : [])
            ]);
            const territories = groups.map(item => {
                const rects = item.photoRects.map(photoVisualRect);
                if (!rects.length) return null;
                const minX = Math.min(...rects.map(rect => rect.x));
                const minY = Math.min(...rects.map(rect => rect.y));
                const maxX = Math.max(...rects.map(rect => rect.x + rect.w));
                const maxY = Math.max(...rects.map(rect => rect.y + rect.h));
                return {
                    groupId: item.id,
                    x: minX,
                    y: minY,
                    w: maxX - minX,
                    h: maxY - minY
                };
            }).filter(Boolean);
            const preferredEdge =
                preferredCityTitleEdge(clusters, mapRect);
            const spot = chooseAttachedLabelSpot(
                group._layoutTitle,
                clusters,
                photoBlockers.concat(labels),
                [],
                mapRect,
                preferredEdge,
                territories
            );
            if (!spot) return;
            group._layoutTitle.labelX = spot.x;
            group._layoutTitle.labelY = spot.y;
            group._layoutTitle.labelW = spot.w;
            group._layoutTitle.labelOverlay = spot.overlay;
            group.titleRect = {
                x: spot.x,
                y: spot.y,
                w: spot.w,
                h: group._layoutTitle.h
            };
            refreshGroupBounds(group);
        });
    }

    function preferCenteredCityTitlesBelow(mapRect) {
        const ordered = groups
            .filter(group => group.photoRects.length)
            .sort((a, b) => {
                const aBottom = Math.max(...a.photoRects.map(rect =>
                    photoVisualRect(rect).y + photoVisualRect(rect).h));
                const bBottom = Math.max(...b.photoRects.map(rect =>
                    photoVisualRect(rect).y + photoVisualRect(rect).h));
                return bBottom - aBottom || a.id.localeCompare(b.id);
            });
        ordered.forEach(group => {
            const clusters = group._layoutEntries
                .filter(entry => Number.isFinite(entry.cluster.worldX))
                .map(entry => ({
                    ...entry.cluster,
                    x: entry.cluster.worldX,
                    y: entry.cluster.worldY
                }));
            if (!clusters.length ||
                preferredCityTitleEdge(clusters, mapRect) !== 'bottom') {
                return;
            }
            const minX = Math.min(...clusters.map(cluster => cluster.x));
            const maxX = Math.max(...clusters.map(cluster =>
                cluster.x + cluster.w));
            const maxY = Math.max(...clusters.map(cluster =>
                cluster.y + cluster.h));
            const blockersNow = () => groups.flatMap(item => [
                ...item.photoRects.map(rect => ({
                    ...photoVisualRect(rect),
                    owner: item
                })),
                ...item.labels.map(label => ({
                    x: label.worldX,
                    y: label.worldY,
                    w: label.width,
                    h: 18,
                    owner: item
                })),
                ...(item !== group && item.titleRect
                    ? [{
                        ...item.titleRect,
                        owner: item
                    }] : [])
            ]);
            const width = group._layoutTitle.w;
            const candidate = {
                x: Math.round((minX + maxX - width) / 2),
                y: Math.round(maxY + 6),
                w: width,
                h: group._layoutTitle.h
            };
            const currentHits = () => blockersNow().filter(rect =>
                rectsOverlapWithPadding(
                    candidate, rect, LABEL_CLEARANCE
                )
            );
            let hits = currentHits();
            if (!hits.length && !labelHitsMap(candidate, mapRect)) {
                commitCenteredTitle();
                return;
            }
            const shifts = new Map();
            hits.forEach(rect => {
                if (!rect.owner || rect.owner === group ||
                    rect.y <= candidate.y) return;
                const required = candidate.y + candidate.h +
                    LABEL_CLEARANCE - rect.y;
                shifts.set(
                    rect.owner,
                    Math.max(shifts.get(rect.owner) || 0, required)
                );
            });
            [...shifts.entries()]
                .sort((a, b) => a[1] - b[1])
                .some(([blocker, required]) => {
                    const distance = safeAxisMove(
                        blocker,
                        'y',
                        1,
                        Math.min(96, required + 4),
                        mapRect,
                        new Set()
                    );
                    if (distance < required) return false;
                    translateGroup(blocker, 0, distance);
                    hits = currentHits();
                    if (!hits.length && !labelHitsMap(candidate, mapRect)) {
                        commitCenteredTitle();
                        return true;
                    }
                    translateGroup(blocker, 0, -distance);
                    return false;
                });

            function commitCenteredTitle() {
                group._layoutTitle.labelX = candidate.x;
                group._layoutTitle.labelY = candidate.y;
                group._layoutTitle.labelW = candidate.w;
                group._layoutTitle.labelOverlay = false;
                group.titleRect = {
                    x: candidate.x,
                    y: candidate.y,
                    w: candidate.w,
                    h: group._layoutTitle.h
                };
                refreshGroupBounds(group);
            }
        });
    }

    function ticketLayoutMetrics() {
        const count = sceneTickets.length;
        const columnWidth = 104;
        const gapX = 8;
        const left = BOARD_FRAME + 14;
        const top = BOARD_FRAME + 186;
        const worldHeight = scene ? scene.worldHeight : 0;
        const bottom = worldHeight - BOARD_FRAME - 28;
        const available = Math.max(1, bottom - top);
        const gapY = 3;
        const rowsPerColumn = Math.max(
            1,
            Math.floor((available + gapY) / (94 + gapY))
        );
        const columns = count
            ? Math.max(1, Math.ceil(count / rowsPerColumn))
            : 0;
        const rows = columns ? Math.ceil(count / columns) : 0;
        const cellHeight = rows
            ? clamp(
                (available - gapY * Math.max(0, rows - 1)) / rows,
                20,
                94
            )
            : 0;
        const totalHeight = rows * cellHeight +
            gapY * Math.max(0, rows - 1);
        return {
            count,
            left,
            top,
            bottom,
            available,
            gapX,
            gapY,
            columnWidth,
            columns,
            rows,
            cellHeight,
            startY: top + Math.max(0, (available - totalHeight) * 0.16),
            reserveWidth: columns
                ? left + columns * columnWidth +
                    Math.max(0, columns - 1) * gapX + 24
                : 0
        };
    }

    function normalizeWorldBounds() {
        const mapRect = scene.mapRect;
        let minX = mapRect.x;
        let minY = mapRect.y;
        let maxX = mapRect.x + mapRect.width;
        let maxY = mapRect.y + mapRect.height;
        groups.forEach(group => {
            minX = Math.min(minX, group.x);
            minY = Math.min(minY, group.y);
            maxX = Math.max(maxX, group.x + group.width);
            maxY = Math.max(maxY, group.y + group.height);
        });
        const shiftX = WORLD_PADDING - minX;
        const shiftY = WORLD_PADDING - minY;
        if (shiftX || shiftY) {
            groups.forEach(group =>
                translateGroup(group, shiftX, shiftY));
            mapRect.x += shiftX;
            mapRect.y += shiftY;
        }
        groups.forEach(group => {
            group.pinX = mapRect.x + group.nx * MAP_WIDTH;
            group.pinY = mapRect.y + group.ny * MAP_HEIGHT;
        });
        scene.worldWidth = maxX - minX + WORLD_PADDING * 2;
        scene.worldHeight = maxY - minY + WORLD_PADDING * 2;
        const ticketMetrics = ticketLayoutMetrics();
        const ticketRailExtra = Math.max(
            0,
            ticketMetrics.reserveWidth - WORLD_PADDING
        );
        if (ticketRailExtra > 0) {
            mapRect.x += ticketRailExtra;
            groups.forEach(group => {
                translateGroup(group, ticketRailExtra, 0);
                group.pinX += ticketRailExtra;
            });
            const mottoRailExtra = Math.round(ticketRailExtra * 0.5);
            scene.worldWidth += ticketRailExtra + mottoRailExtra;
        }
        if (sceneStyleIs('scrapbook') && configuredMotto) {
            const rightmostContent = Math.max(
                mapRect.x + mapRect.width,
                ...groups.flatMap(group =>
                    groupContentRects(group).map(rect => rect.x + rect.w)
                )
            );
            const mottoCardWidth = sceneMottoCardWidth();
            const mottoCardLeft = scene.worldWidth - 2 - mottoCardWidth;
            const extraRight = Math.max(
                0,
                SCRAPBOOK_MOTTO_GAP - (mottoCardLeft - rightmostContent)
            );
            scene.worldWidth += Math.ceil(extraRight);
        }
        refreshBoardBounds();
    }

    function refreshBoardBounds() {
        if (!scene) return;
        const topExtension = Math.max(0, scene.topExtension || 0);
        const boardRect = {
            x: -BOARD_FRAME,
            y: -BOARD_FRAME - topExtension,
            width: scene.worldWidth + BOARD_FRAME * 2,
            height: scene.worldHeight + BOARD_FRAME * 2 + topExtension
        };
        scene.boardRect = boardRect;
        scene.viewRect = {
            x: boardRect.x - SCENE_BREATHING_ROOM,
            y: boardRect.y - SCENE_BREATHING_ROOM,
            width: boardRect.width + SCENE_BREATHING_ROOM * 2,
            height: boardRect.height + SCENE_BREATHING_ROOM * 2
        };
    }

    function finalizeLayoutModel(shiftX, shiftY, mapRect) {
        const mapCenterX = mapRect.x + MAP_WIDTH / 2;
        const mapCenterY = mapRect.y + MAP_HEIGHT / 2;
        groups.forEach(group => {
            const items = group._layoutItems.filter(item =>
                Number.isFinite(item.x) && Number.isFinite(item.y)
            );
            if (!items.length) return;
            group.x = Math.min(...items.map(item => item.x)) + shiftX;
            group.y = Math.min(...items.map(item => item.y)) + shiftY;
            group.width = Math.max(1, Math.max(...items.map(item =>
                item.x + item.w)) + shiftX - group.x);
            group.height = Math.max(1, Math.max(...items.map(item =>
                item.y + item.h)) + shiftY - group.y);
            group.cityLabel = {
                x: group._layoutTitle.x + shiftX - group.x,
                y: group._layoutTitle.y + shiftY - group.y
            };
            group.titleRect = {
                x: group._layoutTitle.x + shiftX,
                y: group._layoutTitle.y + shiftY,
                w: group._layoutTitle.w,
                h: group._layoutTitle.h
            };
            group._placedClusters.forEach(cluster => {
                cluster.photos.forEach(photo => {
                    photo.x = cluster.x + photo.lx;
                    photo.y = cluster.y + photo.ly;
                });
                if (cluster.label) {
                    cluster.label.x = cluster.x + cluster.label.lx;
                    cluster.label.y = cluster.y + cluster.label.ly;
                }
                if (cluster.cityTitle) {
                    cluster.cityTitle.x = cluster.x + cluster.cityTitle.lx;
                    cluster.cityTitle.y = cluster.y + cluster.cityTitle.ly;
                }
            });
            group.photoRects = group._placedPhotos.map(rect => ({
                ...rect,
                width: rect.w,
                height: rect.h,
                lx: rect.x + shiftX - group.x,
                ly: rect.y + shiftY - group.y,
                worldX: rect.x + shiftX,
                worldY: rect.y + shiftY
            }));
            group.ticketRects = [];
            group.ticketLabel = null;
            group.labels = group._layoutEntries
                .filter(entry => Number.isFinite(entry.heading.x))
                .map(entry => ({
                    type: 'footprint',
                    text: entry.footprint.name,
                    footprintId: entry.footprintId,
                    x: entry.heading.x + shiftX - group.x,
                    y: entry.heading.y + shiftY - group.y,
                    width: entry.heading.w,
                    worldX: entry.heading.x + shiftX,
                    worldY: entry.heading.y + shiftY
                }));
            group.footprintClusters = group._layoutEntries.map(entry => {
                const entryItems = [entry.cluster]
                    .filter(item => Number.isFinite(item.x));
                if (!entryItems.length) return null;
                const minX = Math.min(...entryItems.map(item => item.x));
                const minY = Math.min(...entryItems.map(item => item.y));
                const maxX = Math.max(...entryItems.map(item =>
                    item.x + item.w));
                const maxY = Math.max(...entryItems.map(item =>
                    item.y + item.h));
                return {
                    key: entry.footprintId,
                    id: entry.footprintId,
                    title: entry.footprint.name,
                    x: minX + shiftX - group.x,
                    y: minY + shiftY - group.y,
                    width: maxX - minX,
                    height: maxY - minY
                };
            }).filter(Boolean);
            while (group._photoComponents.length > 2) {
                let pair = null;
                let pairDistance = Infinity;
                for (let i = 0; i < group._photoComponents.length; i++) {
                    const a = groupComponentRect(
                        group._photoComponents[i], 0, 0
                    );
                    const aRect = { x: a.x, y: a.y, w: a.w, h: a.h };
                    for (let j = i + 1;
                        j < group._photoComponents.length; j++) {
                        const b = groupComponentRect(
                            group._photoComponents[j], 0, 0
                        );
                        const distance = rectDistance(aRect, {
                            x: b.x,
                            y: b.y,
                            w: b.w,
                            h: b.h
                        });
                        if (distance < pairDistance) {
                            pairDistance = distance;
                            pair = [i, j];
                        }
                    }
                }
                if (!pair) break;
                const target = group._photoComponents[pair[0]];
                target.clusters.push(
                    ...group._photoComponents[pair[1]].clusters
                );
                group._photoComponents.splice(pair[1], 1);
            }
            group.components = group._photoComponents.map(component => {
                const rect = groupComponentRect(component, shiftX, shiftY);
                return {
                    ...rect,
                    id: component.id,
                    lx: rect.x - group.x,
                    ly: rect.y - group.y
                };
            }).sort((a, b) =>
                b.count - a.count || a.y - b.y || a.x - b.x
            );
            group.components.forEach((component, index) => {
                component.primary = index === 0;
            });
            group.layoutColumns = Math.max(1, group.components.length);
            group.layoutType = 'global-maxrects';
            const primary = group.components[0];
            if (primary) {
                const horizontal = Math.abs(
                    primary.x + primary.w / 2 - mapCenterX
                ) / MAP_WIDTH >= Math.abs(
                    primary.y + primary.h / 2 - mapCenterY
                ) / MAP_HEIGHT;
                if (horizontal) {
                    group.lineEndX = primary.x + primary.w / 2 < mapCenterX
                        ? primary.x + primary.w
                        : primary.x;
                    group.lineEndY = primary.y + primary.h / 2;
                } else {
                    group.lineEndX = primary.x + primary.w / 2;
                    group.lineEndY = primary.y + primary.h / 2 < mapCenterY
                        ? primary.y + primary.h
                        : primary.y;
                }
            }
            const secondary = group.components[1];
            group.secondaryLineEndX = secondary
                ? (secondary.x + secondary.w / 2 < mapCenterX
                    ? secondary.x + secondary.w
                    : secondary.x)
                : null;
            group.secondaryLineEndY = secondary
                ? secondary.y + secondary.h / 2
                : null;
            group.worldRect = {
                x: group.x,
                y: group.y,
                width: group.width,
                height: group.height
            };
            group.columnCandidates = group.components.map(component => ({
                count: component.count,
                x: component.x,
                y: component.y,
                width: component.w,
                height: component.h
            }));
            group.pinX = mapRect.x + group.nx * MAP_WIDTH;
            group.pinY = mapRect.y + group.ny * MAP_HEIGHT;
        });
        attachLabelsToClusters(shiftX, shiftY, mapRect);
    }

    function buildLayoutMetrics(startedAt) {
        const gapStartedAt = performance.now();
        const gapMetrics = buildGapMetrics();
        const gapMetricsMs = performance.now() - gapStartedAt;
        const photos = groups.flatMap(group => group.photoRects);
        let overlaps = 0;
        for (let i = 0; i < photos.length; i++) {
            for (let j = i + 1; j < photos.length; j++) {
                if (photos[i].groupId === photos[j].groupId) continue;
                if (rectsOverlapExact(
                    photoVisualRect(photos[i]),
                    photoVisualRect(photos[j])
                )) overlaps++;
            }
        }
        const labelGaps = [];
        const labelGapDetails = [];
        let itemOverlaps = 0;
        groups.forEach(group => {
            group._layoutEntries.forEach(entry => {
                if (Number.isFinite(entry.heading.labelX) &&
                    Number.isFinite(entry.cluster.worldX)) {
                    const gap = rectDistance(
                        {
                            x: entry.heading.labelX,
                            y: entry.heading.labelY,
                            w: entry.heading.labelW,
                            h: entry.heading.h
                        },
                        {
                            x: entry.cluster.worldX,
                            y: entry.cluster.worldY,
                            w: entry.cluster.w,
                            h: entry.cluster.h
                        }
                    );
                    labelGaps.push(gap);
                    labelGapDetails.push({
                        city: group.city,
                        label: entry.footprint.name,
                        type: 'footprint',
                        gap
                    });
                }
            });
            const primary = group.components[0];
            if (primary &&
                Number.isFinite(group._layoutTitle.labelX)) {
                const titleRect = {
                    x: group._layoutTitle.labelX,
                    y: group._layoutTitle.labelY,
                    w: group._layoutTitle.labelW,
                    h: group._layoutTitle.h
                };
                const gap = Math.min(...group.components.map(component =>
                    rectDistance(
                        titleRect,
                        {
                            x: component.x,
                            y: component.y,
                            w: component.w,
                            h: component.h
                        }
                    )
                ));
                labelGaps.push(gap);
                labelGapDetails.push({
                    city: group.city,
                    label: group.city,
                    type: 'city',
                    gap
                });
            }
            const items = group._layoutItems.filter(item =>
                Number.isFinite(item.x) && Number.isFinite(item.y)
            );
            for (let i = 0; i < items.length; i++) {
                for (let j = i + 1; j < items.length; j++) {
                    if (rectsOverlapExact(items[i], items[j])) {
                        itemOverlaps++;
                    }
                }
            }
        });
        const titleRects = groups.map(group => ({
            group,
            rect: group.titleRect
        }));
        const allPhotoRects = groups.flatMap(group =>
            [...group.photoRects, ...group.ticketRects]
                .map(rect => photoVisualRect({
                    ...rect,
                    worldX: rect.worldX,
                    worldY: rect.worldY,
                    width: rect.width,
                    height: rect.height
                }))
                .map(rect => ({
                    ...rect,
                    groupId: group.id
                }))
        );
        const allLabelRects = groups.flatMap(group =>
            group.labels.map(label => ({
                x: label.worldX,
                y: label.worldY,
                w: label.width,
                h: 18
            }))
        );
        let cityTitleOverlaps = 0;
        let titlePhotoOverlaps = 0;
        let titleOwnPhotoOverlaps = 0;
        let titleLabelOverlaps = 0;
        let titleMapIntrusions = 0;
        let labelPhotoOverlaps = 0;
        allLabelRects.forEach(label => {
            allPhotoRects.forEach(photo => {
                if (rectsOverlapExact(label, photo)) {
                    labelPhotoOverlaps++;
                }
            });
        });
        for (let i = 0; i < titleRects.length; i++) {
            const title = titleRects[i].rect;
            if (!title) continue;
            if (labelHitsMap(title, scene.mapRect)) titleMapIntrusions++;
            allPhotoRects.forEach(rect => {
                if (!rectsOverlapExact(title, rect)) return;
                if (rect.groupId === titleRects[i].group.id) {
                    titleOwnPhotoOverlaps++;
                } else {
                    titlePhotoOverlaps++;
                }
            });
            allLabelRects.forEach(rect => {
                if (rectsOverlapExact(title, rect)) titleLabelOverlaps++;
            });
            for (let j = i + 1; j < titleRects.length; j++) {
                const other = titleRects[j].rect;
                if (other && rectsOverlapExact(title, other)) {
                    cityTitleOverlaps++;
                }
            }
        }
        let minGroupSpacing = Infinity;
        let groupSpacingViolations = 0;
        for (let i = 0; i < groups.length; i++) {
            for (let j = i + 1; j < groups.length; j++) {
                const spacing = closestGroupCore(
                    groups[i], groups[j]
                ).gap;
                minGroupSpacing = Math.min(minGroupSpacing, spacing);
                if (spacing < LOCAL_GROUP_GAP - 0.001) {
                    groupSpacingViolations++;
                }
            }
        }
        const groupMapIntrusions = groups.filter(group =>
            groupHitsMap(group, scene.mapRect, 0, 0)
        ).length;
        let mapIntrusions = 0;
        const mapIntrusionDetails = [];
        photos.forEach(rect => {
            const visual = photoVisualRect(rect);
            const samples = [
                [visual.x, visual.y],
                [visual.x + visual.w, visual.y],
                [visual.x, visual.y + visual.h],
                [visual.x + visual.w, visual.y + visual.h],
                [visual.x + visual.w / 2, visual.y + visual.h / 2]
            ];
            if (samples.some(([x, y]) => maskAlphaAt(
                x - scene.mapRect.x - MAP_WIDTH / 2,
                y - scene.mapRect.y - MAP_HEIGHT / 2
            ) > 24)) {
                mapIntrusions++;
                mapIntrusionDetails.push({
                    groupId: rect.groupId,
                    footprint: rect.footprint,
                    x: Math.round(visual.x * 10) / 10,
                    y: Math.round(visual.y * 10) / 10,
                    w: Math.round(visual.w * 10) / 10,
                    h: Math.round(visual.h * 10) / 10
                });
            }
        });
        const input = groups.flatMap(group => group._layoutItems)
            .map(item => [item.id, item.w, item.h,
                item.item && Number.isFinite(item.item.aspect)
                    ? item.item.aspect.toFixed(3) : '4.333'
            ].join(':')).sort().join('|');
        const output = [
            ...groups.flatMap(group => [
                ...group.photoRects.map(rect => [
                    rect.id,
                    rect.worldX,
                    rect.worldY,
                    rect.width,
                    rect.height
                ].join(':')),
                ...group.labels.map(label => [
                    'label',
                    label.footprintId,
                    label.worldX,
                    label.worldY,
                    label.width
                ].join(':')),
                [
                    'title',
                    group.id,
                    group.titleRect.x,
                    group.titleRect.y,
                    group.titleRect.w,
                    group.titleRect.h
                ].join(':'),
                [
                    'group',
                    group.id,
                    group.x,
                    group.y,
                    group.width,
                    group.height
                ].join(':')
            ]),
            [
                'map',
                scene.mapRect.x,
                scene.mapRect.y,
                scene.mapRect.width,
                scene.mapRect.height
            ].join(':')
        ].sort().join('|');
        return {
            version: layoutVersion,
            layoutMs: Math.round((performance.now() - startedAt) * 10) / 10,
            items: photos.length,
            footprintClusters: groups.reduce((sum, group) =>
                sum + group._layoutClusters.length, 0),
            footprintSplits: 0,
            itemOverlaps,
            maxLabelGap: labelGaps.length
                ? Math.round(Math.max(...labelGaps) * 10) / 10
                : 0,
            averageLabelGap: labelGaps.length
                ? Math.round(
                    labelGaps.reduce((sum, gap) => sum + gap, 0) /
                    labelGaps.length * 10
                ) / 10
                : 0,
            labelGapDetails: labelGapDetails
                .sort((a, b) => b.gap - a.gap)
                .slice(0, 8),
            components: groups.reduce((sum, group) =>
                sum + group.components.length, 0),
            maxComponents: Math.max(0, ...groups.map(group =>
                group.components.length)),
            componentCounts: groups.map(group => ({
                city: group.city,
                count: group.components.length
            })),
            overlaps,
            cityTitleOverlaps,
            titlePhotoOverlaps,
            titleOwnPhotoOverlaps,
            titleLabelOverlaps,
            titleMapIntrusions,
            titleOverlays: groups.filter(group =>
                group.cityLabel && group.cityLabel.overlay
            ).length,
            footprintLabelOverlays: groups.reduce((count, group) =>
                count + group.labels.filter(label =>
                    label.overlay
                ).length, 0),
            labelPhotoOverlaps,
            groupSpacingViolations,
            minGroupSpacing: Number.isFinite(minGroupSpacing)
                ? Math.round(minGroupSpacing * 10) / 10
                : 0,
            groupMapIntrusions,
            missingCityTitles: groups.filter(group =>
                !Number.isFinite(group._layoutTitle.labelX)
            ).length,
            missingFootprintLabels: groups.reduce((count, group) =>
                count + group._layoutEntries.filter(entry =>
                    !Number.isFinite(entry.heading.labelX)
                ).length, 0),
            mapIntrusions,
            mapIntrusionDetails,
            headingOverlaps: (() => {
                const heading = sceneHeadingWorldRect();
                return heading
                    ? groups.filter(group =>
                        groupHitsRect(group, heading, 0, 0, 18)
                    ).length
                    : 0;
            })(),
            worldArea: Math.round(scene.worldWidth * scene.worldHeight),
            photoArea: Math.round(photos.reduce((sum, rect) =>
                sum + rect.width * rect.height, 0)),
            gapMetricsMs: Math.round(gapMetricsMs * 10) / 10,
            ...gapMetrics,
            inputHash: stableHash(input).toString(16),
            outputHash: stableHash(output).toString(16)
        };
    }

    function layoutSafeInsets() {
        if (state.immersive) {
            return {
                left: 24,
                right: 24,
                top: 24,
                bottom: 24
            };
        }
        return {
            left: 24,
            right: Math.min(250, Math.max(222, viewport.width * 0.13)),
            top: 104,
            bottom: 72
        };
    }

    function layoutWorld(preserveMapScreen) {
        const startedAt = performance.now();
        const layoutPhaseMs = {};
        let phaseStartedAt = performance.now();
        const markPhase = name => {
            const now = performance.now();
            layoutPhaseMs[name] = Math.round(
                (now - phaseStartedAt) * 10
            ) / 10;
            phaseStartedAt = now;
        };
        const oldMapScreen = preserveMapScreen && scene ? {
            x: scene.mapRect.x + MAP_WIDTH / 2,
            y: scene.mapRect.y + MAP_HEIGHT / 2
        } : null;
        const oldScreenPoint = oldMapScreen ? {
            x: oldMapScreen.x * camera.scale + camera.x,
            y: oldMapScreen.y * camera.scale + camera.y
        } : null;

        groups.forEach(group => {
            group.sprite = null;
            group.spriteDirty = true;
        });
        assignPerimeterPositions();
        const model = buildLayoutModel();
        const photoArea = model.items
            .filter(item => item.kind === 'footprint-cluster')
            .reduce((sum, item) => sum + item.w * item.h, 0);
        const ring = clamp(
            Math.sqrt(Math.max(1, photoArea)) * 0.76 + 220,
            580,
            980
        );
        const grid = buildLayoutGrid(
            MAP_WIDTH + ring * 2,
            MAP_HEIGHT + ring * 2
        );
        const placed = placeLayoutModel(model, grid);
        model.items
            .filter(item => !Number.isFinite(item.x))
            .forEach(item => {
                const group = groups.find(candidate =>
                    candidate.id === item.groupId);
                if (!group) return;
                const spot = chooseLayoutSpot(group, item, placed, grid);
                if (spot) commitLayoutItem(group, item, spot, placed, grid);
            });
        let minX = -MAP_WIDTH / 2;
        let minY = -MAP_HEIGHT / 2;
        let maxX = MAP_WIDTH / 2;
        let maxY = MAP_HEIGHT / 2;
        placed.forEach(item => {
            minX = Math.min(minX, item.x);
            minY = Math.min(minY, item.y);
            maxX = Math.max(maxX, item.x + item.w);
            maxY = Math.max(maxY, item.y + item.h);
        });
        const shiftX = WORLD_PADDING - minX;
        const shiftY = WORLD_PADDING - minY;
        const worldWidth = maxX - minX + WORLD_PADDING * 2;
        const worldHeight = maxY - minY + WORLD_PADDING * 2;
        const mapRect = {
            x: -MAP_WIDTH / 2 + shiftX,
            y: -MAP_HEIGHT / 2 + shiftY,
            width: MAP_WIDTH,
            height: MAP_HEIGHT
        };
        scene = { mapRect, worldWidth, worldHeight };
        finalizeLayoutModel(shiftX, shiftY, mapRect);
        markPhase('finalize');
        compactAdjacentGroups(mapRect);
        markPhase('adjacent');
        pullGroupsTowardMap(mapRect);
        markPhase('pull');
        separateGroupsFromMap(mapRect);
        markPhase('separate');
        resolveLocalGroupConflicts(mapRect);
        markPhase('conflicts');
        compactBandGaps(mapRect);
        markPhase('bandCompaction');
        separateCityTitles(mapRect);
        markPhase('titleSeparation');
        preferCenteredCityTitlesBelow(mapRect);
        markPhase('titleReattach');
        normalizeWorldBounds();
        markPhase('normalize');
        expandSceneForHeading();
        markPhase('headingSeparation');

        const insets = layoutSafeInsets();
        const safeWidth = Math.max(1,
            viewport.width - insets.left - insets.right);
        const safeHeight = Math.max(1,
            viewport.height - insets.top - insets.bottom);
        fitScale = Math.min(
            safeWidth / scene.viewRect.width,
            safeHeight / scene.viewRect.height
        );
        initialScale = Math.min(
            viewport.width * 0.42 / MAP_WIDTH,
            viewport.height * 0.55 / MAP_HEIGHT
        );
        if (oldScreenPoint) {
            const newMapX = mapRect.x + MAP_WIDTH / 2;
            const newMapY = mapRect.y + MAP_HEIGHT / 2;
            camera.x = oldScreenPoint.x - newMapX * camera.scale;
            camera.y = oldScreenPoint.y - newMapY * camera.scale;
            clampCamera();
        }
        layoutDirty = false;
        layoutVersion++;
        layoutMetrics = buildLayoutMetrics(startedAt);
        markPhase('metrics');
        layoutMetrics.layoutPhaseMs = layoutPhaseMs;
        if (debugEnabled) {
            document.documentElement.dataset.layoutMetrics =
                JSON.stringify(layoutMetrics);
            document.documentElement.dataset.layoutMap =
                JSON.stringify(scene.mapRect);
            document.documentElement.dataset.layoutGroups =
                JSON.stringify(groups.map(group => ({
                    city: group.city,
                    side: group.side,
                    angle: group.angle,
                    layoutAnchor: group.layoutAnchor,
                    bounds: groupBounds(group),
                    titleRect: group.titleRect,
                    labels: group.labels,
                    clusters: group._placedClusters.map(cluster => ({
                        id: cluster.id,
                        x: cluster.x,
                        y: cluster.y,
                        w: cluster.w,
                        h: cluster.h,
                        photos: cluster.photos.length
                    })),
                    components: group.components,
                    photos: group.photoRects.map(rect => ({
                        x: rect.worldX,
                        y: rect.worldY,
                        w: rect.width,
                        h: rect.height,
                        groupId: rect.groupId
                    }))
                })));
            window.__travelWallDebug = {
                snapshot() {
                    return {
                        mapRect: { ...scene.mapRect },
                        camera: { ...camera },
                        viewport: { ...viewport },
                        worldWidth: scene.worldWidth,
                        worldHeight: scene.worldHeight,
                        groups: groups.map(group => ({
                            city: group.city,
                            angle: group.angle,
                            layoutAnchor: { ...group.layoutAnchor },
                            bounds: groupBounds(group),
                            titleRect: group.titleRect,
                            labels: group.labels
                        }))
                    };
                },
                focusCity(city) {
                    const group = groups.find(item =>
                        item.city.indexOf(city) >= 0
                    );
                    if (!group) return '';
                    selectGroup(group.id);
                    return group.city;
                },
                probeMoves(limit) {
                    const maxDistance = Math.max(8, Number(limit) || 160);
                    const directions = [
                        { name: 'up', x: 0, y: -1 },
                        { name: 'down', x: 0, y: 1 },
                        { name: 'left', x: -1, y: 0 },
                        { name: 'right', x: 1, y: 0 },
                        { name: 'northwest', x: -1, y: -1 },
                        { name: 'northeast', x: 1, y: -1 },
                        { name: 'southwest', x: -1, y: 1 },
                        { name: 'southeast', x: 1, y: 1 }
                    ];
                    return groups.map(group => {
                        const result = { city: group.city, safe: {} };
                        directions.forEach(direction => {
                            const length = Math.hypot(
                                direction.x, direction.y
                            );
                            let safe = 0;
                            for (let distance = 2;
                                distance <= maxDistance;
                                distance += 2) {
                                if (!canMoveGroup(
                                    group,
                                    direction.x / length * distance,
                                    direction.y / length * distance,
                                    new Set(),
                                    scene.mapRect
                                )) break;
                                safe = distance;
                            }
                            result.safe[direction.name] = safe;
                        });
                        return result;
                    });
                },
                probeTitle(city) {
                    const group = groups.find(item =>
                        item.city.indexOf(city) >= 0
                    );
                    if (!group) return null;
                    const clusters = group._layoutEntries
                        .filter(entry =>
                            Number.isFinite(entry.cluster.worldX)
                        )
                        .map(entry => ({
                            ...entry.cluster,
                            x: entry.cluster.worldX,
                            y: entry.cluster.worldY
                        }));
                    const occupied = groups.flatMap(item =>
                        item.photoRects.map(rect => ({
                            ...photoVisualRect(rect),
                            groupId: item.id
                        }))
                    );
                    const reservedLabels = groups.flatMap(item => {
                        const labels = item.labels.map(label => ({
                            x: label.worldX,
                            y: label.worldY,
                            w: label.width,
                            h: 18,
                            labelKind: 'footprint-label'
                        }));
                        if (item !== group && item.titleRect) {
                            labels.push({
                                ...item.titleRect,
                                labelKind: 'city-title'
                            });
                        }
                        return labels;
                    });
                    const territories = groups.map(item => {
                        const rects = item.photoRects.map(photoVisualRect);
                        if (!rects.length) return null;
                        const minX = Math.min(...rects.map(rect => rect.x));
                        const minY = Math.min(...rects.map(rect => rect.y));
                        const maxX = Math.max(...rects.map(rect =>
                            rect.x + rect.w
                        ));
                        const maxY = Math.max(...rects.map(rect =>
                            rect.y + rect.h
                        ));
                        return {
                            groupId: item.id,
                            x: minX,
                            y: minY,
                            w: maxX - minX,
                            h: maxY - minY
                        };
                    }).filter(Boolean);
                    return chooseAttachedLabelSpot(
                        group._layoutTitle,
                        clusters,
                        occupied,
                        reservedLabels,
                        scene.mapRect,
                        'top',
                        territories
                    );
                }
            };
        }
        updateSummary();
        dirty = true;
        scheduleDraw();
    }

    function buildMapLayer(themeKey) {
        if (mapLayers.has(themeKey)) return mapLayers.get(themeKey);
        const palette = THEMES[themeKey];
        const scale = 3;
        const layer = document.createElement('canvas');
        layer.width = MAP_WIDTH * scale;
        layer.height = MAP_HEIGHT * scale;
        const layerCtx = layer.getContext('2d');
        layerCtx.imageSmoothingEnabled = true;
        layerCtx.imageSmoothingQuality = 'high';
        layerCtx.setTransform(scale, 0, 0, scale, 0, 0);
        const visited = new Set(groups.map(group => group.provinceAdcode));
        const features = (data.geo.features || []).filter(feature => {
            const adcode = String(feature && feature.properties &&
                feature.properties.adcode || '');
            return /^\d{6}$/.test(adcode);
        });
        features.forEach(feature => {
            layerCtx.beginPath();
            geometryPath(layerCtx, feature.geometry);
            layerCtx.fillStyle = visited.has(String(feature.properties.adcode))
                ? palette.mapVisited
                : palette.mapFill;
            layerCtx.fill('evenodd');
            layerCtx.strokeStyle = palette.mapStroke;
            layerCtx.lineWidth = 0.9;
            layerCtx.stroke();
        });
        layerCtx.textAlign = 'center';
        layerCtx.textBaseline = 'middle';
        layerCtx.lineJoin = 'round';
        features.forEach(feature => {
            const properties = feature.properties || {};
            const center = properties.center || properties.centroid;
            if (!Array.isArray(center) || center.length < 2) return;
            const projected = projectToMap(Number(center[0]), Number(center[1]));
            const text = provinceShortName(properties.name);
            if (!text) return;
            const isVisited = visited.has(String(properties.adcode));
            const x = projected.x * MAP_WIDTH;
            const y = projected.y * MAP_HEIGHT;
            layerCtx.font = '600 13px ' + fontText;
            layerCtx.strokeStyle = palette.mapFill;
            layerCtx.lineWidth = 3;
            layerCtx.strokeText(text, x, y);
            layerCtx.fillStyle = isVisited
                ? palette.mapLabelVisited
                : palette.mapLabel;
            layerCtx.fillText(text, x, y);
        });
        mapLayers.set(themeKey, layer);
        return layer;
    }

    function buildMapMask() {
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = MAP_WIDTH;
        maskCanvas.height = MAP_HEIGHT;
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
        const features = (data.geo.features || []).filter(feature => {
            const adcode = String(feature && feature.properties &&
                feature.properties.adcode || '');
            return /^\d{6}$/.test(adcode);
        });
        features.forEach(feature => {
            maskCtx.beginPath();
            geometryPath(maskCtx, feature.geometry);
            maskCtx.fillStyle = '#ffffff';
            maskCtx.fill('evenodd');
        });
        mapMask = {
            data: maskCtx.getImageData(0, 0, MAP_WIDTH, MAP_HEIGHT).data,
            width: MAP_WIDTH,
            height: MAP_HEIGHT
        };
    }

    function maskAlphaAt(x, y) {
        if (!mapMask) return 0;
        const px = Math.round(x + MAP_WIDTH / 2);
        const py = Math.round(y + MAP_HEIGHT / 2);
        if (px < 0 || py < 0 || px >= MAP_WIDTH || py >= MAP_HEIGHT) return 0;
        return mapMask.data[(py * MAP_WIDTH + px) * 4 + 3];
    }

    function mapBoundaryAlongAngle(angle) {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        let lastInside = null;
        const maxDistance = Math.max(MAP_WIDTH, MAP_HEIGHT) * 0.9;
        for (let distance = 0; distance <= maxDistance; distance += 3) {
            const x = dx * distance;
            const y = dy * distance;
            if (maskAlphaAt(x, y) > 24) {
                lastInside = { x, y };
            }
        }
        return lastInside || {
            x: dx * MAP_WIDTH / 2,
            y: dy * MAP_HEIGHT / 2
        };
    }

    function geometryPath(target, geometry) {
        if (!geometry) return;
        const polygons = geometry.type === 'Polygon'
            ? [geometry.coordinates]
            : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
        polygons.forEach(polygon => {
            (polygon || []).forEach(ring => {
                ring.forEach((point, index) => {
                    if (!Array.isArray(point) || point.length < 2) return;
                    const projected = projectToMap(Number(point[0]), Number(point[1]));
                    const x = projected.x * MAP_WIDTH;
                    const y = projected.y * MAP_HEIGHT;
                    if (index === 0) target.moveTo(x, y);
                    else target.lineTo(x, y);
                });
                target.closePath();
            });
        });
    }

    function provinceShortName(name) {
        return String(name || '')
            .replace(/特别行政区$/, '')
            .replace(/维吾尔自治区$/, '')
            .replace(/壮族自治区$/, '')
            .replace(/回族自治区$/, '')
            .replace(/自治区$/, '')
            .replace(/[省市]$/, '');
    }

    function buildLoadPlan() {
        const generation = ++loadGeneration;
        loadQueue.length = 0;
        groups.forEach(group => {
            group.mediaItems.forEach(item => {
                if (item && item.groups) item.groups.add(group);
            });
            group.ready = group.mediaItems.every(item =>
                item.status === 'loaded' || item.status === 'error'
            );
            if (group.ready) group.spriteDirty = true;
        });
        const centerX = scene.mapRect.x + MAP_WIDTH / 2;
        const centerY = scene.mapRect.y + MAP_HEIGHT / 2;
        const sorted = groups.slice().sort((a, b) => {
            const aPrimary = a.components[0];
            const bPrimary = b.components[0];
            const ad = Math.hypot(
                (aPrimary ? aPrimary.x + aPrimary.w / 2 : a.x + a.width / 2) - centerX,
                (aPrimary ? aPrimary.y + aPrimary.h / 2 : a.y + a.height / 2) - centerY
            );
            const bd = Math.hypot(
                (bPrimary ? bPrimary.x + bPrimary.w / 2 : b.x + b.width / 2) - centerX,
                (bPrimary ? bPrimary.y + bPrimary.h / 2 : b.y + b.height / 2) - centerY
            );
            return ad - bd;
        });
        const ordered = [];
        const seen = new Set();
        const addItem = item => {
            if (!item || seen.has(item)) return;
            seen.add(item);
            ordered.push(item);
        };
        const maxDepth = Math.max(0, ...sorted.map(group => group.mediaItems.length));
        for (let depth = 0; depth < maxDepth; depth++) {
            sorted.forEach(group => {
                addItem(group.mediaItems[depth]);
            });
        }
        sceneTickets.forEach(ticket => addItem(ticket.item));

        queuedImages = ordered.length;
        finishedImages = ordered.filter(item =>
            item.status === 'loaded' || item.status === 'error'
        ).length;
        failedImages = ordered.filter(item => item.status === 'error').length;
        ordered.forEach(item => {
            item.loadGeneration = generation;
            if (item.status === 'idle') {
                item.status = 'queued';
                loadQueue.push(item);
            }
        });
        loadPlanReady = true;
        drainImageQueue();
    }

    function drainImageQueue() {
        while (loadingImages < IMAGE_CONCURRENCY && loadQueue.length) {
            const item = loadQueue.shift();
            if (!item || item.status === 'loaded' || item.status === 'error') continue;
            loadingImages++;
            loadImageItem(item);
        }
        updateLoadingState();
    }

    function stopPendingImageLoads() {
        loadQueue.forEach(item => {
            if (item && item.status === 'queued') item.status = 'idle';
        });
        loadQueue.length = 0;
    }

    function loadImageItem(item, useProxy) {
        item.status = 'loading';
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        item.image = image;
        image.onload = () => {
            loadingImages--;
            if (item.loadGeneration === loadGeneration) {
                finishedImages++;
            }
            const width = image.naturalWidth || image.width;
            const height = image.naturalHeight || image.height;
            if (width && height) item.aspect = width / height;
            createThumbnailSprite(item);
            item.status = 'loaded';
            item.groups.forEach(group => {
                group.ready = group.mediaItems.every(other =>
                    other.status === 'loaded' || other.status === 'error'
                );
                if (group.ready) group.spriteDirty = true;
            });
            scheduleRelayout();
            dirty = true;
            drainImageQueue();
        };
        image.onerror = () => {
            if (!useProxy && window.location.protocol.indexOf('http') === 0) {
                try {
                    const absolute = new URL(item.url, window.location.href);
                    if (absolute.origin !== window.location.origin) {
                        loadImageItem(item, true);
                        return;
                    }
                } catch (error) {
                    // fall through to the error state
                }
            }
            loadingImages--;
            if (item.loadGeneration === loadGeneration) {
                finishedImages++;
                failedImages++;
            }
            item.status = 'error';
            item.groups.forEach(group => {
                group.ready = group.mediaItems.every(other =>
                    other.status === 'loaded' || other.status === 'error'
                );
                if (group.ready) group.spriteDirty = true;
            });
            scheduleRelayout();
            dirty = true;
            drainImageQueue();
        };
        const sourceUrl = wallThumbnailUrl(item.url);
        image.src = useProxy
            ? window.location.origin + '/footprints/image-proxy?url=' +
                encodeURIComponent(new URL(sourceUrl, window.location.href).href)
            : sourceUrl;
    }

    function createThumbnailSprite(item) {
        const image = item.image;
        if (!image || !image.width || !image.height) return;
        const max = THUMBNAIL_MAX;
        const aspect = image.width / image.height;
        let width = max;
        let height = width / aspect;
        if (height > max) {
            height = max;
            width = max * aspect;
        }
        const sprite = document.createElement('canvas');
        sprite.width = Math.max(24, Math.round(width));
        sprite.height = Math.max(24, Math.round(height));
        const spriteCtx = sprite.getContext('2d');
        spriteCtx.imageSmoothingEnabled = true;
        spriteCtx.imageSmoothingQuality = 'high';
        spriteCtx.drawImage(image, 0, 0, sprite.width, sprite.height);
        item.sprite = sprite;
        item.image = null;
    }

    function scheduleRelayout(force) {
        layoutDirty = true;
        const waitingForImages = queuedImages > 0 &&
            (loadingImages > 0 || loadQueue.length > 0 ||
                finishedImages < queuedImages);
        if (!force && waitingForImages) return;
        if (layoutTimer) window.clearTimeout(layoutTimer);
        layoutTimer = window.setTimeout(() => {
            layoutTimer = 0;
            layoutWorld(true);
        }, force ? 0 : 380);
    }

    function ensureLayoutSettled() {
        if (layoutTimer) {
            window.clearTimeout(layoutTimer);
            layoutTimer = 0;
        }
        if (layoutDirty) layoutWorld(true);
    }

    function resize() {
        if (!root.classList.contains('show')) return;
        clearDragSnapshot();
        const width = window.innerWidth;
        const height = window.innerHeight;
        viewport = {
            width,
            height,
            dpr: Math.min(
                MAX_RENDER_PIXEL_RATIO,
                Math.max(MIN_RENDER_PIXEL_RATIO, window.devicePixelRatio || 1)
            )
        };
        canvas.width = Math.round(width * viewport.dpr);
        canvas.height = Math.round(height * viewport.dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        layoutWorld(true);
        clampCamera();
        tooSmallNotice.hidden = width >= 1280 && height >= 720;
        if (state.previewPhoto) {
            previewFigure.style.width = '';
            window.requestAnimationFrame(fitPreviewFrameToImage);
        }
        dirty = true;
        scheduleDraw();
    }

    function setMapFocusedView(animate) {
        const target = {
            scale: initialScale,
            x: viewport.width / 2 - (scene.mapRect.x + MAP_WIDTH / 2) * initialScale,
            y: viewport.height / 2 - (scene.mapRect.y + MAP_HEIGHT / 2) * initialScale
        };
        if (animate && !reduceMotion) animateCamera(target, 420);
        else {
            camera = target;
            clampCamera();
            dirty = true;
            scheduleDraw();
        }
    }

    function setFitView(animate, options = {}) {
        const insets = layoutSafeInsets();
        const availableWidth = Math.max(1,
            viewport.width - insets.left - insets.right);
        const availableHeight = Math.max(1,
            viewport.height - insets.top - insets.bottom);
        const target = {
            scale: fitScale,
            x: insets.left +
                (availableWidth - scene.viewRect.width * fitScale) / 2 -
                scene.viewRect.x * fitScale,
            y: insets.top +
                (availableHeight - scene.viewRect.height * fitScale) / 2 -
                scene.viewRect.y * fitScale
        };
        if (animate && !reduceMotion) {
            animateCamera(
                target,
                Number(options.duration) || 420,
                options
            );
        } else {
            camera = target;
            clampCamera();
            dirty = true;
            scheduleDraw();
        }
    }

    function setImmersive(enabled, restoreView = true) {
        const next = !!enabled;
        if (state.immersive === next) return;
        state.immersive = next;
        root.classList.toggle('is-immersive', next);
        immersiveBtn.setAttribute('aria-pressed', String(next));
        immersiveExitBtn.hidden = !next;
        if (next) {
            cameraBeforeImmersive = { ...camera };
            dismissGestureNote();
            if (sceneReady) setFitView(true);
            window.requestAnimationFrame(() => immersiveExitBtn.focus());
            return;
        }
        const previousCamera = restoreView ? cameraBeforeImmersive : null;
        cameraBeforeImmersive = null;
        if (previousCamera && sceneReady) {
            animateCamera(previousCamera, 320);
        } else {
            dirty = true;
            scheduleDraw();
        }
        if (root.classList.contains('show')) immersiveBtn.focus();
    }

    function animateCamera(target, duration, options = {}) {
        const from = { ...camera };
        const fromScale = Math.max(0.0001, from.scale);
        const targetScale = Math.max(0.0001, target.scale);
        const started = performance.now();
        const run = now => {
            const raw = Math.min(1, (now - started) / duration);
            const eased = options.easing === 'in-out'
                ? (raw < 0.5
                    ? 4 * raw * raw * raw
                    : 1 - Math.pow(-2 * raw + 2, 3) / 2)
                : 1 - Math.pow(1 - raw, 3);
            camera = {
                x: from.x + (target.x - from.x) * eased,
                y: from.y + (target.y - from.y) * eased,
                scale: options.logZoom
                    ? fromScale * Math.pow(targetScale / fromScale, eased)
                    : from.scale + (target.scale - from.scale) * eased
            };
            dirty = true;
            scheduleDraw();
            if (raw < 1) requestAnimationFrame(run);
        };
        requestAnimationFrame(run);
    }

    function playInitialFitTransition() {
        if (!initialFitPending || initialFitFrame) return;
        initialFitFrame = requestAnimationFrame(() => {
            initialFitFrame = requestAnimationFrame(() => {
                initialFitFrame = 0;
                if (!root.classList.contains('show') ||
                    !sceneReady ||
                    imagesLoading()) {
                    return;
                }
                initialFitPending = false;
                ensureLayoutSettled();
                setFitView(true, {
                    duration: 680,
                    easing: 'in-out',
                    logZoom: true
                });
            });
        });
    }

    function clampCamera() {
        const minScale = fitScale * 0.9;
        const maxScale = Math.max(initialScale * 4, minScale);
        camera.scale = clamp(camera.scale, minScale, maxScale);
        const marginX = PAN_MARGIN_X;
        const marginY = PAN_MARGIN_Y;
        const worldWidth = scene.worldWidth * camera.scale;
        const worldHeight = scene.worldHeight * camera.scale;
        if (worldWidth <= viewport.width) {
            const centerX = (viewport.width - worldWidth) / 2;
            camera.x = clamp(
                camera.x,
                centerX - PAN_MARGIN_X,
                centerX + PAN_MARGIN_X
            );
        } else {
            camera.x = clamp(camera.x,
                viewport.width - worldWidth - marginX,
                marginX);
        }
        if (worldHeight <= viewport.height) {
            const centerY = (viewport.height - worldHeight) / 2;
            camera.y = clamp(
                camera.y,
                centerY - PAN_MARGIN_Y,
                centerY + PAN_MARGIN_Y
            );
        } else {
            camera.y = clamp(camera.y,
                viewport.height - worldHeight - marginY,
                marginY);
        }
    }

    function zoomAt(x, y, factor) {
        const before = screenToWorld({ x, y });
        camera.scale = clamp(
            camera.scale * factor,
            fitScale * 0.9,
            Math.max(initialScale * 4, fitScale)
        );
        camera.x = x - before.x * camera.scale;
        camera.y = y - before.y * camera.scale;
        clampCamera();
        dirty = true;
        scheduleDraw();
    }

    function screenToWorld(point) {
        return {
            x: (point.x - camera.x) / camera.scale,
            y: (point.y - camera.y) / camera.scale
        };
    }

    function scheduleDraw() {
        if (drawScheduled) return;
        drawScheduled = true;
        requestAnimationFrame(draw);
    }

    function materialTile(themeKey, kind) {
        const key = themeKey + ':' + kind;
        if (materialPatterns.has(key)) return materialPatterns.get(key);

        const size = kind === 'wall' ? 180 :
            (kind === 'paper' ? 128 : (kind === 'table' ? 224 : 144));
        const tile = document.createElement('canvas');
        tile.width = size;
        tile.height = size;
        const tileCtx = tile.getContext('2d');
        let seed = stableHash(key) || 1;
        const random = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
        };

        if (kind === 'wall') {
            tileCtx.strokeStyle = 'rgba(68, 59, 50, 0.035)';
            tileCtx.lineWidth = 0.7;
            for (let index = 0; index < 34; index++) {
                const y = random() * size;
                tileCtx.beginPath();
                tileCtx.moveTo(random() * 34, y);
                tileCtx.lineTo(size - random() * 34, y + random() * 1.5);
                tileCtx.stroke();
            }
        } else if (kind === 'table') {
            const palette = THEMES[themeKey];
            tileCtx.strokeStyle = palette.boardWeave;
            tileCtx.lineWidth = 0.9;
            for (let offset = 16; offset < size; offset += 26) {
                tileCtx.beginPath();
                tileCtx.moveTo(0, offset + random() * 3);
                tileCtx.bezierCurveTo(
                    size * 0.28,
                    offset - 4 + random() * 8,
                    size * 0.68,
                    offset + 4 - random() * 8,
                    size,
                    offset + random() * 3
                );
                tileCtx.stroke();
            }
            tileCtx.fillStyle = palette.boardFleck;
            for (let index = 0; index < 30; index++) {
                tileCtx.beginPath();
                tileCtx.ellipse(
                    random() * size,
                    random() * size,
                    1 + random() * 2.2,
                    0.5 + random(),
                    random() * Math.PI,
                    0,
                    Math.PI * 2
                );
                tileCtx.fill();
            }
        } else if (kind === 'board') {
            const palette = THEMES[themeKey];
            tileCtx.strokeStyle = palette.boardWeave;
            tileCtx.lineWidth = 0.8;
            for (let offset = 0; offset < size; offset += 11) {
                tileCtx.beginPath();
                tileCtx.moveTo(0, offset + 0.5);
                tileCtx.lineTo(size, offset + 0.5);
                tileCtx.stroke();
                tileCtx.beginPath();
                tileCtx.moveTo(offset + 0.5, 0);
                tileCtx.lineTo(offset + 0.5, size);
                tileCtx.stroke();
            }
            tileCtx.fillStyle = palette.boardFleck;
            for (let index = 0; index < 96; index++) {
                const length = 0.8 + random() * 2.4;
                tileCtx.fillRect(
                    random() * size,
                    random() * size,
                    length,
                    Math.max(0.6, random() * 1.2)
                );
            }
        } else {
            const palette = THEMES[themeKey];
            tileCtx.fillStyle = 'rgba(88, 70, 48, 0.026)';
            for (let index = 0; index < 120; index++) {
                tileCtx.fillRect(
                    random() * size,
                    random() * size,
                    0.5 + random() * 1.2,
                    0.5 + random() * 1.2
                );
            }
            tileCtx.strokeStyle = palette.mapFold;
            tileCtx.lineWidth = 0.45;
            for (let index = 0; index < 18; index++) {
                const x = random() * size;
                tileCtx.beginPath();
                tileCtx.moveTo(x, random() * size);
                tileCtx.lineTo(x + 4 + random() * 12, random() * size);
                tileCtx.stroke();
            }
        }

        materialPatterns.set(key, tile);
        return tile;
    }

    function materialPattern(target, themeKey, kind) {
        const tile = materialTile(themeKey, kind);
        return target.createPattern(tile, 'repeat');
    }

    function paintRoomBackdrop(target) {
        const dpr = viewport.dpr;
        target.setTransform(dpr, 0, 0, dpr, 0, 0);
        const width = viewport.width;
        const height = viewport.height;
        const palette = theme();
        const wall = target.createLinearGradient(
            width * 0.12, 0, width * 0.82, height
        );
        wall.addColorStop(0, palette.wallTop);
        wall.addColorStop(0.56, palette.background);
        wall.addColorStop(1, palette.wallBottom);
        target.fillStyle = wall;
        target.fillRect(0, 0, width, height);

        if (sceneStyleIs('scrapbook')) {
            const tablePattern = materialPattern(
                target,
                state.theme,
                'table'
            );
            if (tablePattern) {
                target.globalAlpha = 0.78;
                target.fillStyle = tablePattern;
                target.fillRect(0, 0, width, height);
                target.globalAlpha = 1;
            }
        }

        const daylight = target.createRadialGradient(
            width * 0.08, -height * 0.12, 0,
            width * 0.08, -height * 0.12, Math.max(width, height) * 0.92
        );
        daylight.addColorStop(0, palette.wallLight);
        daylight.addColorStop(0.48, 'rgba(255, 255, 255, 0)');
        daylight.addColorStop(1, palette.wallShade);
        target.fillStyle = daylight;
        target.fillRect(0, 0, width, height);

        const wallPattern = materialPattern(target, state.theme, 'wall');
        if (wallPattern) {
            target.globalAlpha = 0.55;
            target.fillStyle = wallPattern;
            target.fillRect(0, 0, width, height);
            target.globalAlpha = 1;
        }

        if (sceneStyleIs('scrapbook')) {
            const tableLight = target.createRadialGradient(
                width * 0.48,
                height * 0.18,
                0,
                width * 0.48,
                height * 0.18,
                Math.max(width, height) * 0.78
            );
            tableLight.addColorStop(0, 'rgba(255, 235, 200, 0.25)');
            tableLight.addColorStop(0.56, 'rgba(255, 255, 255, 0)');
            tableLight.addColorStop(1, 'rgba(37, 24, 16, 0.3)');
            target.fillStyle = tableLight;
            target.fillRect(0, 0, width, height);
        }
    }

    function ensureRoomBackdropCache() {
        const key = [
            state.theme,
            viewport.width,
            viewport.height,
            viewport.dpr
        ].join(':');
        if (roomBackdropCache && roomBackdropCacheKey === key) {
            return roomBackdropCache;
        }
        const cache = document.createElement('canvas');
        cache.width = Math.max(1, Math.round(viewport.width * viewport.dpr));
        cache.height = Math.max(1, Math.round(viewport.height * viewport.dpr));
        const cacheCtx = cache.getContext('2d');
        paintRoomBackdrop(cacheCtx);
        roomBackdropCache = cache;
        roomBackdropCacheKey = key;
        return cache;
    }

    function drawRoomBackdrop() {
        const cache = ensureRoomBackdropCache();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(cache, 0, 0);
    }

    function paintTapeStrip(target, x, y, width, height, angle, alpha) {
        target.save();
        target.translate(x + width / 2, y + height / 2);
        target.rotate(angle * Math.PI / 180);
        target.globalAlpha = alpha;
        target.fillStyle = '#eadcb9';
        target.fillRect(-width / 2, -height / 2, width, height);
        target.strokeStyle = 'rgba(117, 91, 55, 0.2)';
        target.lineWidth = 0.6;
        target.beginPath();
        target.moveTo(-width / 2 + 2, -height / 2 + 2);
        target.lineTo(width / 2 - 2, -height / 2 + 2);
        target.moveTo(-width / 2 + 2, height / 2 - 2);
        target.lineTo(width / 2 - 2, height / 2 - 2);
        target.stroke();
        target.restore();
    }

    function paintScrapbookSurface(target) {
        const palette = theme();
        const board = scene.boardRect;
        const inset = 12;
        const inner = {
            x: board.x + inset,
            y: board.y + inset,
            width: board.width - inset * 2,
            height: board.height - inset * 2
        };
        target.save();
        target.shadowColor = palette.ambientShadow;
        target.shadowBlur = 32;
        target.shadowOffsetX = 8;
        target.shadowOffsetY = 14;
        roundRectPath(
            target,
            board.x,
            board.y,
            board.width,
            board.height,
            10
        );
        target.fillStyle = palette.boardDeep;
        target.fill();
        target.restore();

        const paperTone = target.createLinearGradient(
            inner.x, inner.y, inner.x + inner.width, inner.y + inner.height
        );
        paperTone.addColorStop(0, palette.board);
        paperTone.addColorStop(0.62, palette.board);
        paperTone.addColorStop(1, palette.boardDeep);
        roundRectPath(
            target,
            inner.x,
            inner.y,
            inner.width,
            inner.height,
            5
        );
        target.fillStyle = paperTone;
        target.fill();

        target.save();
        roundRectPath(
            target,
            inner.x,
            inner.y,
            inner.width,
            inner.height,
            5
        );
        target.clip();
        const pattern = materialPattern(target, state.theme, 'board');
        if (pattern) {
            target.fillStyle = pattern;
            target.fillRect(inner.x, inner.y, inner.width, inner.height);
        }
        const glow = target.createRadialGradient(
            inner.x + inner.width * 0.2,
            inner.y + inner.height * 0.08,
            0,
            inner.x + inner.width * 0.2,
            inner.y + inner.height * 0.08,
            Math.max(inner.width, inner.height)
        );
        glow.addColorStop(0, palette.warmLight);
        glow.addColorStop(0.6, 'rgba(255, 255, 255, 0)');
        glow.addColorStop(1, palette.wallShade);
        target.fillStyle = glow;
        target.fillRect(inner.x, inner.y, inner.width, inner.height);
        target.restore();

        target.save();
        target.setLineDash([7, 6]);
        target.strokeStyle = palette.line;
        target.lineWidth = 1;
        roundRectPath(
            target,
            inner.x + 9,
            inner.y + 9,
            inner.width - 18,
            inner.height - 18,
            4
        );
        target.stroke();
        target.restore();

        paintTapeStrip(
            target,
            inner.x - 8,
            inner.y - 6,
            92,
            22,
            -8,
            0.88
        );
        paintTapeStrip(
            target,
            inner.x + inner.width - 84,
            inner.y - 6,
            92,
            22,
            8,
            0.88
        );
        paintTapeStrip(
            target,
            inner.x - 8,
            inner.y + inner.height - 16,
            92,
            22,
            8,
            0.82
        );
        paintTapeStrip(
            target,
            inner.x + inner.width - 84,
            inner.y + inner.height - 16,
            92,
            22,
            -8,
            0.82
        );
    }

    function paintStudioBoard(target) {
        if (sceneStyleIs('scrapbook')) {
            paintScrapbookSurface(target);
            return;
        }
        const palette = theme();
        const board = scene.boardRect;
        const inner = {
            x: board.x + BOARD_FRAME,
            y: board.y + BOARD_FRAME,
            width: board.width - BOARD_FRAME * 2,
            height: board.height - BOARD_FRAME * 2
        };

        target.save();
        target.shadowColor = palette.ambientShadow;
        target.shadowBlur = 38;
        target.shadowOffsetX = 8;
        target.shadowOffsetY = 14;
        roundRectPath(target, board.x, board.y, board.width, board.height, 7);
        target.fillStyle = palette.frameWood;
        target.fill();
        target.restore();

        const frame = target.createLinearGradient(
            board.x, board.y, board.x + board.width, board.y + board.height
        );
        frame.addColorStop(0, palette.frameLight);
        frame.addColorStop(0.28, palette.frameWood);
        frame.addColorStop(1, palette.frameDeep);
        roundRectPath(target, board.x, board.y, board.width, board.height, 7);
        target.fillStyle = frame;
        target.fill();

        const boardTone = target.createLinearGradient(
            inner.x, inner.y, inner.x + inner.width, inner.y + inner.height
        );
        boardTone.addColorStop(0, palette.board);
        boardTone.addColorStop(0.42, palette.board);
        boardTone.addColorStop(1, palette.boardDeep);
        roundRectPath(
            target,
            inner.x,
            inner.y,
            inner.width,
            inner.height,
            2
        );
        target.fillStyle = boardTone;
        target.fill();

        target.save();
        roundRectPath(
            target,
            inner.x,
            inner.y,
            inner.width,
            inner.height,
            2
        );
        target.clip();
        const boardPattern = materialPattern(target, state.theme, 'board');
        if (boardPattern) {
            target.fillStyle = boardPattern;
            target.fillRect(inner.x, inner.y, inner.width, inner.height);
        }
        const boardLight = target.createRadialGradient(
            inner.x + inner.width * 0.14,
            inner.y + inner.height * 0.08,
            0,
            inner.x + inner.width * 0.14,
            inner.y + inner.height * 0.08,
            Math.max(inner.width, inner.height) * 0.92
        );
        boardLight.addColorStop(0, palette.warmLight);
        boardLight.addColorStop(0.52, 'rgba(255, 255, 255, 0)');
        boardLight.addColorStop(1, palette.wallShade);
        target.fillStyle = boardLight;
        target.fillRect(inner.x, inner.y, inner.width, inner.height);
        target.restore();

        roundRectPath(target, board.x, board.y, board.width, board.height, 7);
        target.strokeStyle = palette.frameDeep;
        target.lineWidth = 1.2;
        target.stroke();
        roundRectPath(
            target,
            inner.x - 1,
            inner.y - 1,
            inner.width + 2,
            inner.height + 2,
            3
        );
        target.strokeStyle = 'rgba(34, 26, 20, 0.42)';
        target.lineWidth = 2;
        target.stroke();

        target.save();
        target.strokeStyle = palette.frameLight;
        target.globalAlpha = 0.62;
        target.lineWidth = 1.2;
        target.beginPath();
        target.moveTo(board.x + 8, board.y + 3);
        target.lineTo(board.x + board.width - 9, board.y + 3);
        target.moveTo(board.x + 3, board.y + 8);
        target.lineTo(board.x + 3, board.y + board.height - 10);
        target.stroke();
        target.restore();

        target.save();
        target.strokeStyle = 'rgba(25, 18, 14, 0.48)';
        target.globalAlpha = 0.6;
        target.lineWidth = 1;
        target.beginPath();
        target.moveTo(board.x + 9, board.y + board.height - 3);
        target.lineTo(board.x + board.width - 3, board.y + board.height - 3);
        target.moveTo(board.x + board.width - 3, board.y + 9);
        target.lineTo(board.x + board.width - 3, board.y + board.height - 3);
        target.stroke();
        target.restore();

    }

    function paintMapPaperBase(target) {
        const palette = theme();
        const mapRect = scene.mapRect;

        target.save();
        target.shadowColor = palette.ambientShadow;
        target.shadowBlur = 15;
        target.shadowOffsetX = 4;
        target.shadowOffsetY = 7;
        target.fillStyle = palette.mapPaper;
        target.fillRect(mapRect.x, mapRect.y, mapRect.width, mapRect.height);
        target.restore();

        target.save();
        target.shadowColor = palette.contactShadow;
        target.shadowBlur = 2;
        target.shadowOffsetY = 1;
        target.fillStyle = palette.mapPaper;
        target.fillRect(mapRect.x, mapRect.y, mapRect.width, mapRect.height);
        target.restore();

        const paperTone = target.createLinearGradient(
            mapRect.x,
            mapRect.y,
            mapRect.x + mapRect.width,
            mapRect.y + mapRect.height
        );
        paperTone.addColorStop(0, 'rgba(255, 255, 255, 0.11)');
        paperTone.addColorStop(0.46, 'rgba(255, 255, 255, 0)');
        paperTone.addColorStop(1, palette.mapFold);
        target.fillStyle = paperTone;
        target.fillRect(mapRect.x, mapRect.y, mapRect.width, mapRect.height);

        const paperPattern = materialPattern(target, state.theme, 'paper');
        if (paperPattern) {
            target.globalAlpha = 0.72;
            target.fillStyle = paperPattern;
            target.fillRect(mapRect.x, mapRect.y, mapRect.width, mapRect.height);
            target.globalAlpha = 1;
        }
    }

    function paintMapPaperEdges(target) {
        const palette = theme();
        const mapRect = scene.mapRect;
        target.strokeStyle = palette.mapPaperEdge;
        target.lineWidth = 0.9;
        target.strokeRect(
            mapRect.x + 0.5,
            mapRect.y + 0.5,
            mapRect.width - 1,
            mapRect.height - 1
        );
        target.save();
        target.strokeStyle = 'rgba(255, 253, 248, 0.72)';
        target.lineWidth = 1;
        target.beginPath();
        target.moveTo(mapRect.x + 2, mapRect.y + 2);
        target.lineTo(mapRect.x + mapRect.width - 3, mapRect.y + 2);
        target.moveTo(mapRect.x + 2, mapRect.y + 2);
        target.lineTo(mapRect.x + 2, mapRect.y + mapRect.height - 4);
        target.stroke();
        target.restore();

        if (sceneStyleIs('scrapbook')) {
            paintTapeStrip(
                target,
                mapRect.x - 10,
                mapRect.y - 7,
                76,
                20,
                -10,
                0.88
            );
            paintTapeStrip(
                target,
                mapRect.x + mapRect.width - 66,
                mapRect.y - 7,
                76,
                20,
                10,
                0.88
            );
            paintTapeStrip(
                target,
                mapRect.x - 10,
                mapRect.y + mapRect.height - 13,
                76,
                20,
                10,
                0.82
            );
            paintTapeStrip(
                target,
                mapRect.x + mapRect.width - 66,
                mapRect.y + mapRect.height - 13,
                76,
                20,
                -10,
                0.82
            );
        }
    }

    function sceneHeadingTitleSize() {
        return clamp(
            Math.round(scene.worldHeight * 0.052),
            42,
            56
        );
    }

    function sceneMottoCardWidth() {
        if (!configuredMotto || !scene) return 0;
        const characters = Array.from(configuredMotto);
        const desiredSize = sceneHeadingTitleSize() * 1.6;
        const rangeSize = scene.worldHeight * 0.45 /
            (characters.length * 1.08);
        const fontSize = clamp(
            Math.round(Math.min(desiredSize, rangeSize)),
            18,
            96
        );
        return fontSize * 1.62;
    }

    function sceneHeadingMetrics(target = ctx) {
        const summary = wallSummary.textContent || '正在准备旅行记忆墙';
        if (!configuredTitle && !summary) return null;
        const titleSize = sceneHeadingTitleSize();
        const metaSize = clamp(
            Math.round(scene.worldHeight * 0.019),
            12,
            16
        );
        const labelPaddingX = 20;
        const labelPaddingY = 15;
        const accentWidth = 3;
        const lineGap = configuredTitle ? 10 : 0;
        const titleLineHeight = configuredTitle ? titleSize * 1.05 : 0;
        target.font = '500 ' + titleSize +
            'px "快看世界体", "MiSans", "PingFang SC", sans-serif';
        const titleWidth = configuredTitle
            ? target.measureText(configuredTitle).width : 0;
        target.font = '500 ' + metaSize + 'px ' + fontText;
        const metaWidth = summary ? target.measureText(summary).width : 0;
        const labelWidthFinal = Math.max(titleWidth, metaWidth) +
            labelPaddingX * 2 + accentWidth;
        const labelHeight = labelPaddingY * 2 + titleLineHeight +
            lineGap + (summary ? metaSize : 0);
        return {
            summary,
            titleSize,
            metaSize,
            labelPaddingX,
            labelPaddingY,
            accentWidth,
            lineGap,
            titleLineHeight,
            width: labelWidthFinal,
            height: labelHeight
        };
    }

    function paintSceneHeading(target) {
        const metrics = sceneHeadingMetrics(target);
        if (!metrics) return;
        const board = scene.boardRect;
        const labelX = board.x + BOARD_FRAME + 26;
        const labelY = board.y + BOARD_FRAME + 26;
        const {
            summary,
            titleSize,
            metaSize,
            labelPaddingX,
            labelPaddingY,
            accentWidth,
            lineGap,
            titleLineHeight
        } = metrics;

        target.save();
        target.textAlign = 'left';
        target.textBaseline = 'top';
        if (sceneStyleIs('scrapbook')) {
            target.translate(
                labelX + metrics.width / 2,
                labelY + metrics.height / 2
            );
            target.rotate(-0.8 * Math.PI / 180);
            target.translate(
                -(labelX + metrics.width / 2),
                -(labelY + metrics.height / 2)
            );
        }
        target.shadowColor = sceneStyleIs('classic')
            ? 'rgba(62, 47, 34, 0.14)'
            : theme().ambientShadow;
        target.shadowBlur = 12;
        target.shadowOffsetX = 2;
        target.shadowOffsetY = 4;
        roundRectPath(
            target,
            labelX,
            labelY,
            metrics.width,
            metrics.height,
            10
        );
        target.fillStyle = sceneStyleIs('scrapbook')
            ? 'rgba(252, 243, 224, 0.96)'
            : 'rgba(250, 246, 237, 0.9)';
        target.fill();
        target.shadowColor = 'transparent';
        target.strokeStyle = sceneStyleIs('scrapbook')
            ? 'rgba(104, 80, 56, 0.22)'
            : 'rgba(104, 80, 56, 0.18)';
        target.lineWidth = 0.8;
        target.stroke();

        target.fillStyle = theme().accent;
        roundRectPath(
            target,
            labelX + 1,
            labelY + 11,
            accentWidth,
            metrics.height - 22,
            2
        );
        target.fill();

        const contentX = labelX + accentWidth + labelPaddingX;
        let contentY = labelY + labelPaddingY;
        if (configuredTitle) {
            target.fillStyle = 'rgba(57, 43, 31, 0.92)';
            target.font = '500 ' + titleSize +
                'px "快看世界体", "MiSans", "PingFang SC", sans-serif';
            target.fillText(configuredTitle, contentX, contentY);
            contentY += titleLineHeight + lineGap;
        }
        if (summary) {
            target.fillStyle = 'rgba(81, 65, 49, 0.62)';
            target.font = '500 ' + metaSize + 'px ' + fontText;
            target.fillText(summary, contentX, contentY);
        }
        target.restore();

        if (sceneStyleIs('scrapbook')) {
            paintTapeStrip(
                target,
                labelX + 8,
                labelY - 8,
                64,
                18,
                -8,
                0.92
            );
            paintTapeStrip(
                target,
                labelX + metrics.width - 72,
                labelY - 8,
                64,
                18,
                8,
                0.92
            );
        }
    }

    function paintSceneTickets(target) {
        sceneTicketRects = [];
        if (!sceneTickets.length) return;
        const palette = theme();
        const board = scene.boardRect;
        const metrics = ticketLayoutMetrics();
        const left = board.x + metrics.left;
        const gapX = metrics.gapX;
        const columnWidth = metrics.columnWidth;
        const rows = metrics.rows;
        const gapY = metrics.gapY;
        const cellHeight = metrics.cellHeight;
        const startY = board.y + (scene.topExtension || 0) + metrics.startY;

        sceneTickets.forEach((ticket, index) => {
            const item = ticket.item;
            const column = Math.floor(index / rows);
            const row = index % rows;
            const angle = (
                (stableHash(ticket.key + '|ticket-strip') % 100) / 100 - 0.5
            ) * 1.8;
            const centerX = left + columnWidth / 2 +
                column * (columnWidth + gapX);
            const centerY = startY + cellHeight / 2 +
                row * (cellHeight + gapY);

            target.save();
            target.translate(centerX, centerY);
            target.rotate(angle * Math.PI / 180);

            if (item && item.sprite) {
                const imageAspect = item.sprite.width / item.sprite.height;
                let drawWidth = columnWidth;
                let drawHeight = drawWidth / imageAspect;
                if (drawHeight > cellHeight) {
                    drawHeight = cellHeight;
                    drawWidth = drawHeight * imageAspect;
                }
                const drawX = -drawWidth / 2;
                const drawY = -drawHeight / 2;
                target.save();
                target.shadowColor = palette.ambientShadow;
                target.shadowBlur = 9;
                target.shadowOffsetX = 2.5;
                target.shadowOffsetY = 4;
                target.drawImage(
                    item.sprite,
                    drawX,
                    drawY,
                    drawWidth,
                    drawHeight
                );
                target.restore();
                target.drawImage(
                    item.sprite,
                    drawX,
                    drawY,
                    drawWidth,
                    drawHeight
                );
                target.strokeStyle = 'rgba(44, 31, 21, 0.22)';
                target.lineWidth = 0.55;
                target.strokeRect(drawX, drawY, drawWidth, drawHeight);
                sceneTicketRects.push({
                    key: ticket.key,
                    city: ticket.city,
                    item,
                    kind: 'ticket',
                    footprint: ticket.name,
                    createTime: ticket.createTime,
                    centerX,
                    centerY,
                    rotation: angle,
                    worldX: centerX - drawWidth / 2,
                    worldY: centerY - drawHeight / 2,
                    width: drawWidth,
                    height: drawHeight
                });
            } else {
                target.fillStyle = 'rgba(91, 68, 47, 0.2)';
                roundRectPath(
                    target,
                    -columnWidth / 2,
                    -cellHeight / 2,
                    columnWidth,
                    cellHeight,
                    1
                );
                target.fill();
                target.fillStyle = palette.soft;
                target.font = '500 8px ' + fontText;
                target.textAlign = 'center';
                target.textBaseline = 'middle';
                target.fillText(
                    item && item.status === 'error' ? '票根' : '加载中',
                    0,
                    0
                );
                sceneTicketRects.push({
                    key: ticket.key,
                    city: ticket.city,
                    item,
                    kind: 'ticket',
                    footprint: ticket.name,
                    createTime: ticket.createTime,
                    centerX,
                    centerY,
                    rotation: angle,
                    worldX: centerX - columnWidth / 2,
                    worldY: centerY - cellHeight / 2,
                    width: columnWidth,
                    height: cellHeight
                });
            }
            target.restore();
        });
    }

    function ensureSceneTicketCache() {
        if (!scene || !sceneReady || imagesLoading() || !sceneTickets.length) {
            return null;
        }
        const board = scene.boardRect;
        const rect = {
            x: board.x - SCENE_CACHE_PADDING,
            y: board.y - SCENE_CACHE_PADDING,
            width: board.width + SCENE_CACHE_PADDING * 2,
            height: board.height + SCENE_CACHE_PADDING * 2
        };
        const maxSide = 8192;
        const scale = Math.min(
            SCENE_CACHE_SCALE,
            maxSide / rect.width,
            maxSide / rect.height
        );
        const key = [
            state.theme,
            layoutVersion,
            rect.width,
            rect.height,
            scale
        ].join(':');
        if (sceneTicketCache && sceneTicketCacheKey === key) {
            return sceneTicketCache;
        }

        const cache = document.createElement('canvas');
        cache.width = Math.max(1, Math.ceil(rect.width * scale));
        cache.height = Math.max(1, Math.ceil(rect.height * scale));
        const cacheCtx = cache.getContext('2d');
        cacheCtx.setTransform(
            scale, 0, 0, scale,
            -rect.x * scale,
            -rect.y * scale
        );
        paintSceneTickets(cacheCtx);
        sceneTicketCache = { canvas: cache, rect, scale };
        sceneTicketCacheKey = key;
        return sceneTicketCache;
    }

    function drawSceneTickets() {
        if (!sceneTickets.length) {
            sceneTicketRects = [];
            return;
        }
        const cache = ensureSceneTicketCache();
        if (!cache) {
            paintSceneTickets(ctx);
            return;
        }
        ctx.drawImage(
            cache.canvas,
            cache.rect.x,
            cache.rect.y,
            cache.rect.width,
            cache.rect.height
        );
    }

    function drawTicketHover(target) {
        const ticket = state.hoveredTicket;
        if (!ticket) return;
        target.save();
        target.translate(ticket.centerX, ticket.centerY);
        target.rotate(ticket.rotation * Math.PI / 180);
        roundRectPath(
            target,
            -ticket.width / 2 - 3,
            -ticket.height / 2 - 3,
            ticket.width + 6,
            ticket.height + 6,
            2
        );
        target.strokeStyle = theme().accent;
        target.lineWidth = 1.6;
        target.globalAlpha = 0.9;
        target.stroke();
        target.restore();
    }

    function paintSceneMotto(target) {
        if (!configuredMotto) return;
        const palette = theme();
        const board = scene.boardRect;
        const contentTop = board.y + (scene.topExtension || 0);
        const characters = Array.from(configuredMotto);
        const bandTop = contentTop + BOARD_FRAME + scene.worldHeight * 0.05;
        const bandBottom = contentTop + BOARD_FRAME + scene.worldHeight * 0.50;
        const desiredSize = sceneHeadingTitleSize() * 1.6;
        const rangeSize = (bandBottom - bandTop) /
            (characters.length * 1.08);
        const fontSize = clamp(
            Math.round(Math.min(desiredSize, rangeSize)),
            18,
            96
        );
        const spacing = fontSize * 1.08;
        const textHeight = fontSize + spacing * (characters.length - 1);
        const cardWidth = sceneMottoCardWidth();
        const cardHeight = textHeight + fontSize * 0.9;
        const cardCenterX = sceneStyleIs('classic')
            ? board.x + board.width - BOARD_FRAME / 2
            : board.x + board.width - BOARD_FRAME - cardWidth / 2 - 18;
        const centerX = cardCenterX;
        const startY = bandTop + fontSize / 2;
        const cardCenterY = startY + textHeight / 2 - fontSize / 2;

        if (!sceneStyleIs('classic')) {
            target.save();
            if (sceneStyleIs('scrapbook')) {
                target.translate(cardCenterX, cardCenterY);
                target.rotate(1.2 * Math.PI / 180);
                target.translate(-cardCenterX, -cardCenterY);
            }
            target.shadowColor = palette.ambientShadow;
            target.shadowBlur = 13;
            target.shadowOffsetX = 3;
            target.shadowOffsetY = 5;
            roundRectPath(
                target,
                cardCenterX - cardWidth / 2,
                cardCenterY - cardHeight / 2,
                cardWidth,
                cardHeight,
                5
            );
            target.fillStyle = 'rgba(248, 238, 218, 0.96)';
            target.fill();
            target.shadowColor = 'transparent';
            target.strokeStyle = palette.line;
            target.lineWidth = 0.8;
            target.stroke();
            target.restore();

            if (sceneStyleIs('scrapbook')) {
                paintTapeStrip(
                    target,
                    cardCenterX - 28,
                    cardCenterY - cardHeight / 2 - 7,
                    56,
                    18,
                    -5,
                    0.9
                );
                paintTapeStrip(
                    target,
                    cardCenterX - 28,
                    cardCenterY + cardHeight / 2 - 10,
                    56,
                    18,
                    5,
                    0.86
                );
            }
        }

        target.save();
        target.font = '400 ' + fontSize + 'px ' + mottoFont;
        target.textAlign = 'center';
        target.textBaseline = 'middle';
        const mottoColor = palette.mottoInk;

        characters.forEach((character, index) => {
            const y = startY + spacing * index;
            target.save();
            target.shadowColor = palette.mottoShadow;
            target.shadowBlur = sceneStyleIs('classic')
                ? fontSize * 0.16 : fontSize * 0.06;
            target.shadowOffsetX = sceneStyleIs('classic')
                ? fontSize * 0.03 : fontSize * 0.02;
            target.shadowOffsetY = sceneStyleIs('classic')
                ? fontSize * 0.05 : fontSize * 0.03;
            target.fillStyle = mottoColor;
            target.fillText(character, centerX, y);
            target.restore();
        });
        target.restore();
    }

    function paintSceneLighting(target) {
        const dpr = viewport.dpr;
        const width = viewport.width;
        const height = viewport.height;
        const palette = theme();
        target.setTransform(dpr, 0, 0, dpr, 0, 0);

        const light = target.createLinearGradient(
            width * 0.08, 0, width * 0.9, height
        );
        light.addColorStop(0, palette.warmLight);
        light.addColorStop(0.42, 'rgba(255, 255, 255, 0)');
        light.addColorStop(1, palette.coolShade);
        target.fillStyle = light;
        target.fillRect(0, 0, width, height);

        const vignette = target.createRadialGradient(
            width * 0.48,
            height * 0.46,
            Math.min(width, height) * 0.24,
            width * 0.48,
            height * 0.46,
            Math.max(width, height) * 0.72
        );
        vignette.addColorStop(0, 'rgba(18, 17, 17, 0)');
        vignette.addColorStop(0.72, 'rgba(18, 17, 17, 0.035)');
        vignette.addColorStop(1, 'rgba(18, 17, 17, 0.15)');
        target.fillStyle = vignette;
        target.fillRect(0, 0, width, height);
    }

    function ensureSceneLightingCache() {
        const key = [
            state.theme,
            viewport.width,
            viewport.height,
            viewport.dpr
        ].join(':');
        if (sceneLightingCache && sceneLightingCacheKey === key) {
            return sceneLightingCache;
        }
        const cache = document.createElement('canvas');
        cache.width = Math.max(1, Math.round(viewport.width * viewport.dpr));
        cache.height = Math.max(1, Math.round(viewport.height * viewport.dpr));
        const cacheCtx = cache.getContext('2d');
        paintSceneLighting(cacheCtx);
        sceneLightingCache = cache;
        sceneLightingCacheKey = key;
        return cache;
    }

    function drawSceneLighting() {
        const cache = ensureSceneLightingCache();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(cache, 0, 0);
    }

    function ensureSceneBaseCache() {
        if (!scene || !loadPlanReady || layoutDirty || layoutTimer) {
            return null;
        }
        const board = scene.boardRect;
        const rect = {
            x: board.x - SCENE_CACHE_PADDING,
            y: board.y - SCENE_CACHE_PADDING,
            width: board.width + SCENE_CACHE_PADDING * 2,
            height: board.height + SCENE_CACHE_PADDING * 2
        };
        const maxSide = 8192;
        const scale = Math.min(
            SCENE_CACHE_SCALE,
            maxSide / rect.width,
            maxSide / rect.height
        );
        const key = [
            state.theme,
            layoutVersion,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            scale
        ].join(':');
        if (sceneBaseCache && sceneBaseCacheKey === key) {
            return sceneBaseCache;
        }

        const cache = document.createElement('canvas');
        cache.width = Math.max(1, Math.ceil(rect.width * scale));
        cache.height = Math.max(1, Math.ceil(rect.height * scale));
        const cacheCtx = cache.getContext('2d');
        cacheCtx.setTransform(
            scale, 0, 0, scale,
            -rect.x * scale,
            -rect.y * scale
        );
        paintStudioBoard(cacheCtx);
        paintMapPaperBase(cacheCtx);
        const mapLayer = buildMapLayer(state.theme);
        cacheCtx.drawImage(
            mapLayer,
            scene.mapRect.x,
            scene.mapRect.y,
            scene.mapRect.width,
            scene.mapRect.height
        );
        paintMapPaperEdges(cacheCtx);
        paintSceneHeading(cacheCtx);

        sceneBaseCache = { canvas: cache, rect, scale };
        sceneBaseCacheKey = key;
        sceneReady = true;
        wallSnapshotCache = null;
        wallSnapshotCacheKey = '';
        wallTileCache = null;
        wallTileCacheKey = '';
        scheduleWallSnapshotBuild();
        updateLoadingState();
        if (!imagesLoading()) completeLoadingState();
        document.documentElement.dataset.sceneCache = JSON.stringify({
            width: cache.width,
            height: cache.height,
            scale,
            layoutVersion
        });
        return sceneBaseCache;
    }

    function drawSceneBase() {
        const cache = ensureSceneBaseCache();
        if (cache) {
            ctx.drawImage(
                cache.canvas,
                cache.rect.x,
                cache.rect.y,
                cache.rect.width,
                cache.rect.height
            );
            return;
        }
        paintStudioBoard(ctx);
        paintMapPaperBase(ctx);
        const mapLayer = buildMapLayer(state.theme);
        ctx.drawImage(
            mapLayer,
            scene.mapRect.x,
            scene.mapRect.y,
            scene.mapRect.width,
            scene.mapRect.height
        );
        paintMapPaperEdges(ctx);
        paintSceneHeading(ctx);
    }

    function scheduleWallSnapshotBuild() {
        if (wallSnapshotTimer) window.clearTimeout(wallSnapshotTimer);
        wallSnapshotTimer = window.setTimeout(() => {
            wallSnapshotTimer = 0;
            if (!dragging) {
                ensureWallSnapshotCache();
                ensureWallTileCache();
            }
        }, 500);
    }

    function ensureWallSnapshotCache() {
        if (!scene || !sceneReady ||
            imagesLoading() || layoutDirty || layoutTimer ||
            !groups.length ||
            groups.some(group => !group.ready)) {
            return null;
        }
        const base = ensureSceneBaseCache();
        if (!base) return null;
        const rect = { ...base.rect };
        const scale = Math.min(
            WALL_SNAPSHOT_SCALE,
            WALL_SNAPSHOT_MAX_SIDE / rect.width,
            WALL_SNAPSHOT_MAX_SIDE / rect.height
        );
        const zoomLabels = camera.scale / Math.max(0.001, initialScale) >=
            LABEL_ZOOM_THRESHOLD;
        const labelMode = (state.selectedId
            ? 'selected:' + state.selectedId
            : (state.hoveredId ? 'hover:' + state.hoveredId : 'idle')) +
            ':' + (zoomLabels ? 'labels' : 'plain');
        const key = [
            state.theme,
            layoutVersion,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            scale,
            labelMode
        ].join(':');
        if (wallSnapshotCache && wallSnapshotCacheKey === key) {
            return wallSnapshotCache;
        }

        const cache = document.createElement('canvas');
        cache.width = Math.max(1, Math.ceil(rect.width * scale));
        cache.height = Math.max(1, Math.ceil(rect.height * scale));
        const cacheCtx = cache.getContext('2d');
        cacheCtx.imageSmoothingEnabled = true;
        cacheCtx.imageSmoothingQuality = 'high';
        cacheCtx.setTransform(
            scale, 0, 0, scale,
            -rect.x * scale,
            -rect.y * scale
        );
        cacheCtx.drawImage(
            base.canvas,
            rect.x,
            rect.y,
            rect.width,
            rect.height
        );
        drawConnectors(cacheCtx);
        groups.slice()
            .sort((a, b) => {
                const aa = a.id === state.selectedId
                    ? 2 : (a.id === state.hoveredId ? 1 : 0);
                const bb = b.id === state.selectedId
                    ? 2 : (b.id === state.hoveredId ? 1 : 0);
                return aa - bb;
            })
            .forEach(group => {
                if (!group.sprite || group.spriteDirty) {
                    buildGroupSprite(group);
                }
                drawGroupSprite(cacheCtx, group);
                drawGroupDetails(cacheCtx, group);
            });
        groups.forEach(group => drawCityPin(group, cacheCtx));
        paintSceneTickets(cacheCtx);
        paintSceneMotto(cacheCtx);

        wallSnapshotCache = { canvas: cache, rect, scale };
        wallSnapshotCacheKey = key;
        completeLoadingState();
        return wallSnapshotCache;
    }

    function ensureWallTileCache() {
        const cache = ensureWallSnapshotCache();
        if (!cache) return null;
        const key = [
            wallSnapshotCacheKey,
            WALL_TILE_WORLD_SIZE
        ].join(':');
        if (wallTileCache && wallTileCacheKey === key) {
            return wallTileCache;
        }

        const tiles = [];
        const columns = Math.ceil(
            cache.rect.width / WALL_TILE_WORLD_SIZE
        );
        const rows = Math.ceil(
            cache.rect.height / WALL_TILE_WORLD_SIZE
        );
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const worldX = cache.rect.x +
                    column * WALL_TILE_WORLD_SIZE;
                const worldY = cache.rect.y +
                    row * WALL_TILE_WORLD_SIZE;
                const worldWidth = Math.min(
                    WALL_TILE_WORLD_SIZE,
                    cache.rect.x + cache.rect.width - worldX
                );
                const worldHeight = Math.min(
                    WALL_TILE_WORLD_SIZE,
                    cache.rect.y + cache.rect.height - worldY
                );
                const sourceX = (worldX - cache.rect.x) * cache.scale;
                const sourceY = (worldY - cache.rect.y) * cache.scale;
                const sourceWidth = worldWidth * cache.scale;
                const sourceHeight = worldHeight * cache.scale;
                const tile = document.createElement('canvas');
                tile.width = Math.max(1, Math.ceil(sourceWidth));
                tile.height = Math.max(1, Math.ceil(sourceHeight));
                const tileCtx = tile.getContext('2d');
                tileCtx.drawImage(
                    cache.canvas,
                    sourceX,
                    sourceY,
                    sourceWidth,
                    sourceHeight,
                    0,
                    0,
                    tile.width,
                    tile.height
                );
                tiles.push({
                    canvas: tile,
                    x: worldX,
                    y: worldY,
                    width: worldWidth,
                    height: worldHeight
                });
            }
        }
        wallTileCache = { key, tiles, scale: cache.scale };
        wallTileCacheKey = key;
        return wallTileCache;
    }

    function drawWallSnapshotRegion(target, cache, visible) {
        const left = Math.max(visible.x, cache.rect.x);
        const top = Math.max(visible.y, cache.rect.y);
        const right = Math.min(
            visible.x + visible.width,
            cache.rect.x + cache.rect.width
        );
        const bottom = Math.min(
            visible.y + visible.height,
            cache.rect.y + cache.rect.height
        );
        if (right <= left || bottom <= top) return true;
        const sourceX = (left - cache.rect.x) * cache.scale;
        const sourceY = (top - cache.rect.y) * cache.scale;
        const sourceWidth = (right - left) * cache.scale;
        const sourceHeight = (bottom - top) * cache.scale;
        target.drawImage(
            cache.canvas,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            left,
            top,
            right - left,
            bottom - top
        );
        return true;
    }

    function drawWallSnapshot() {
        const cache = ensureWallSnapshotCache();
        if (!cache) return false;
        return drawWallSnapshotRegion(ctx, cache, {
            x: -camera.x / camera.scale,
            y: -camera.y / camera.scale,
            width: viewport.width / camera.scale,
            height: viewport.height / camera.scale
        });
    }

    function drawWallTilesRegion(target, cache, visible) {
        cache.tiles.forEach(tile => {
            const left = Math.max(visible.x, tile.x);
            const top = Math.max(visible.y, tile.y);
            const right = Math.min(
                visible.x + visible.width,
                tile.x + tile.width
            );
            const bottom = Math.min(
                visible.y + visible.height,
                tile.y + tile.height
            );
            if (right <= left || bottom <= top) return;
            const sourceX = (left - tile.x) * cache.scale;
            const sourceY = (top - tile.y) * cache.scale;
            const sourceWidth = (right - left) * cache.scale;
            const sourceHeight = (bottom - top) * cache.scale;
            target.drawImage(
                tile.canvas,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                left,
                top,
                right - left,
                bottom - top
            );
        });
    }

    function prepareDragSnapshot() {
        const tiles = ensureWallTileCache();
        if (!tiles) return false;
        const overscanX = Math.max(
            DRAG_SURFACE_OVERSCAN_X,
            Math.round(viewport.width * 0.3)
        );
        const overscanY = Math.max(
            DRAG_SURFACE_OVERSCAN_Y,
            Math.round(viewport.height * 0.3)
        );
        const displayWidth = viewport.width + overscanX * 2;
        const displayHeight = viewport.height + overscanY * 2;
        const scale = Math.min(
            viewport.dpr,
            DRAG_SURFACE_MAX_SIDE / displayWidth,
            DRAG_SURFACE_MAX_SIDE / displayHeight
        );
        dragCanvas.width = Math.max(1, Math.ceil(displayWidth * scale));
        dragCanvas.height = Math.max(1, Math.ceil(displayHeight * scale));
        dragCanvas.style.left = -overscanX + 'px';
        dragCanvas.style.top = -overscanY + 'px';
        dragCanvas.style.width = displayWidth + 'px';
        dragCanvas.style.height = displayHeight + 'px';
        dragCanvas.style.transform = 'translate3d(0, 0, 0)';
        dragSurface.classList.add('is-active');

        const backdrop = ensureRoomBackdropCache();
        dragBackdrop.width = backdrop.width;
        dragBackdrop.height = backdrop.height;
        dragBackdropCtx.drawImage(backdrop, 0, 0);
        const lighting = ensureSceneLightingCache();
        dragLighting.width = lighting.width;
        dragLighting.height = lighting.height;
        dragLightingCtx.drawImage(lighting, 0, 0);

        dragCtx.setTransform(1, 0, 0, 1, 0, 0);
        dragCtx.clearRect(0, 0, dragCanvas.width, dragCanvas.height);
        dragCtx.setTransform(
            camera.scale * scale, 0, 0, camera.scale * scale,
            (camera.x + overscanX) * scale,
            (camera.y + overscanY) * scale
        );
        drawWallTilesRegion(dragCtx, tiles, {
            x: -(camera.x + overscanX) / camera.scale,
            y: -(camera.y + overscanY) / camera.scale,
            width: displayWidth / camera.scale,
            height: displayHeight / camera.scale
        });

        dragSnapshotCamera = { ...camera };
        dragSnapshotOverscanX = overscanX;
        dragSnapshotOverscanY = overscanY;
        dragSnapshotActive = true;
        return true;
    }

    function updateDragSnapshot() {
        if (!dragSnapshotActive || !dragSnapshotCamera) return;
        const dx = camera.x - dragSnapshotCamera.x;
        const dy = camera.y - dragSnapshotCamera.y;
        if (Math.abs(dx) > dragSnapshotOverscanX * 0.72 ||
            Math.abs(dy) > dragSnapshotOverscanY * 0.72) {
            prepareDragSnapshot();
            return;
        }
        dragCanvas.style.transform =
            'translate3d(' + dx + 'px, ' + dy + 'px, 0)';
    }

    function clearDragSnapshot() {
        dragSnapshotActive = false;
        dragSnapshotCamera = null;
        dragSurface.classList.remove('is-active');
    }

    function draw(now) {
        drawScheduled = false;
        if (!dirty && now >= stressUntil) return;
        if (dragging && dragSnapshotActive) return;
        dirty = false;
        const start = performance.now();
        const dpr = viewport.dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawRoomBackdrop();
        ctx.setTransform(
            camera.scale * dpr, 0, 0, camera.scale * dpr,
            camera.x * dpr, camera.y * dpr
        );

        const snapshotDrawn = dragging && drawWallSnapshot();
        if (!snapshotDrawn) {
            drawSceneBase();
            drawConnectors();
            groups.slice()
                .sort((a, b) => {
                    const aa = a.id === state.selectedId ? 2 : (a.id === state.hoveredId ? 1 : 0);
                    const bb = b.id === state.selectedId ? 2 : (b.id === state.hoveredId ? 1 : 0);
                    return aa - bb;
                })
                .forEach(group => drawGroup(group));
            groups.forEach(group => drawCityPin(group));
            drawSceneTickets();
            paintSceneMotto(ctx);
        }
        drawTicketHover(ctx);
        drawSceneLighting();
        drawMiniMap();

        const frameMs = performance.now() - start;
        recordPerformance(now, frameMs);
        updateZoom();
        if (now < stressUntil) {
            dirty = true;
            scheduleDraw();
        }
    }

    function drawConnectors(target = ctx) {
        const hasFocus = !!(state.selectedId || state.hoveredId);
        groups.forEach(group => {
            const active = group.id === state.selectedId || group.id === state.hoveredId;
            const drawLink = (endX, endY, secondary) => {
                if (!Number.isFinite(endX) || !Number.isFinite(endY)) return;
                if (secondary && !active) return;
                const midX = (group.pinX + endX) / 2;
                const midY = (group.pinY + endY) / 2;
                target.beginPath();
                target.moveTo(group.pinX, group.pinY);
                if (group.side === 'left' || group.side === 'right') {
                    target.bezierCurveTo(midX, group.pinY, midX, endY, endX, endY);
                } else {
                    target.bezierCurveTo(group.pinX, midY, endX, midY, endX, endY);
                }
                target.setLineDash(secondary ? [4, 5] : []);
                target.strokeStyle = active
                    ? (secondary ? theme().thread : theme().lineActive)
                    : theme().thread;
                target.lineWidth = active ? (secondary ? 1 : 2.4) : 1.35;
                target.globalAlpha = active
                    ? (secondary ? 0.78 : 1)
                    : (hasFocus
                        ? (state.selectedId ? 0.18 : 0.34)
                        : 0.88);
                target.stroke();
                target.globalAlpha = 1;
            };
            drawLink(group.lineEndX, group.lineEndY, false);
            drawLink(group.secondaryLineEndX, group.secondaryLineEndY, true);
        });
        target.setLineDash([]);
    }

    function ensurePinSprite(active) {
        const key = state.theme + ':' + (active ? 'active' : 'idle');
        if (pinSprites.has(key)) return pinSprites.get(key);

        const radius = active ? 9 : 7;
        const padding = 11;
        const size = (radius + padding) * 2;
        const scale = 4;
        const palette = theme();
        const sprite = document.createElement('canvas');
        sprite.width = Math.ceil(size * scale);
        sprite.height = Math.ceil(size * scale);
        const spriteCtx = sprite.getContext('2d');
        spriteCtx.setTransform(scale, 0, 0, scale, 0, 0);
        const center = size / 2;

        spriteCtx.save();
        spriteCtx.shadowColor = palette.contactShadow;
        spriteCtx.shadowBlur = 2;
        spriteCtx.shadowOffsetX = 0.8;
        spriteCtx.shadowOffsetY = 1.2;
        spriteCtx.beginPath();
        spriteCtx.arc(center, center, radius, 0, Math.PI * 2);
        spriteCtx.fillStyle = active ? palette.accent : palette.frame;
        spriteCtx.fill();
        spriteCtx.restore();

        spriteCtx.beginPath();
        spriteCtx.arc(center, center, radius, 0, Math.PI * 2);
        spriteCtx.strokeStyle = active ? palette.frame : palette.accent;
        spriteCtx.lineWidth = active ? 1.6 : 1;
        spriteCtx.stroke();

        const result = { canvas: sprite, size };
        pinSprites.set(key, result);
        return result;
    }

    function drawCityPin(group, target = ctx) {
        const active = group.id === state.selectedId ||
            group.id === state.hoveredId;
        const sprite = ensurePinSprite(active);
        target.drawImage(
            sprite.canvas,
            group.pinX - sprite.size / 2,
            group.pinY - sprite.size / 2,
            sprite.size,
            sprite.size
        );
        if (active) {
            target.fillStyle = theme().frame;
            target.font = '600 10px ' + fontText;
            target.textAlign = 'center';
            target.textBaseline = 'middle';
            target.fillText(String(group.footprints.length), group.pinX, group.pinY + 0.5);
        }
    }

    function drawGroupSprite(target, group) {
        if (!group.ready ||
            !group.sprite ||
            group.sprite.width <= 0 ||
            group.sprite.height <= 0) {
            return false;
        }
        const padding = group.spritePadding || 0;
        target.drawImage(
            group.sprite,
            group.x - padding,
            group.y - padding,
            group.width + padding * 2,
            group.height + padding * 2
        );
        return true;
    }

    function drawGroup(group) {
        const active = group.id === state.selectedId || group.id === state.hoveredId;
        const hasFocus = !!(state.selectedId || state.hoveredId);
        ctx.save();
        if (hasFocus && !active) {
            ctx.globalAlpha = state.selectedId ? 0.54 : 0.7;
        }
        if (!Number.isFinite(group.x) ||
            !Number.isFinite(group.y) ||
            !Number.isFinite(group.width) ||
            !Number.isFinite(group.height) ||
            group.width <= 0 ||
            group.height <= 0) {
            ctx.restore();
            return;
        }
        if (group.ready && (!group.sprite || group.spriteDirty)) {
            buildGroupSprite(group);
        }
        if (!drawGroupSprite(ctx, group)) {
            drawLiveGroup(group);
        }
        drawGroupDetails(ctx, group);
        ctx.restore();
        if (active) {
            if (state.hoveredFootprint &&
                state.hoveredFootprint.groupId === group.id) {
                const footprintId = state.hoveredFootprint.footprintId;
                const labels = group.labels.filter(label =>
                    label.footprintId === footprintId);
                ctx.save();
                ctx.globalAlpha = 0.78;
                ctx.strokeStyle = theme().accent;
                ctx.lineWidth = 1.2;
                group.photoRects
                    .filter(rect =>
                        rect.footprintId === footprintId)
                    .forEach(rect => {
                        roundRectPath(
                            ctx,
                            rect.worldX - 2,
                            rect.worldY - 2,
                            rect.width + 4,
                            rect.height + 4,
                            6
                        );
                        ctx.stroke();
                    });
                labels.forEach(label => {
                    roundRectPath(
                        ctx,
                        label.worldX - 5,
                        label.worldY - 4,
                        label.width + 10,
                        26,
                        7
                    );
                    ctx.fillStyle = theme().accentSoft;
                    ctx.fill();
                    ctx.stroke();
                });
                ctx.restore();
                if (labels.length) {
                    ctx.save();
                    ctx.translate(group.x, group.y);
                    labels.forEach(label => drawFootprintLabel(ctx, label));
                    ctx.restore();
                }
            }
            const hoveredPhoto = state.hoveredPhoto;
            if (hoveredPhoto && hoveredPhoto.groupId === group.id) {
                const centerX = hoveredPhoto.worldX + hoveredPhoto.width / 2;
                const centerY = hoveredPhoto.worldY + hoveredPhoto.height / 2;
                ctx.save();
                ctx.translate(centerX, centerY);
                if (hoveredPhoto.rotation) {
                    ctx.rotate(hoveredPhoto.rotation * Math.PI / 180);
                }
                ctx.shadowColor = theme().accent;
                ctx.shadowBlur = 8;
                roundRectPath(
                    ctx,
                    -hoveredPhoto.width / 2 - 2.5,
                    -hoveredPhoto.height / 2 - 2.5,
                    hoveredPhoto.width + 5,
                    hoveredPhoto.height + 5,
                    5
                );
                ctx.strokeStyle = theme().accent;
                ctx.lineWidth = 1.8;
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    function shouldDrawFootprintLabels(group) {
        if (exporting) return true;
        if (state.selectedId) return group.id === state.selectedId;
        if (state.hoveredId) return group.id === state.hoveredId;
        return camera.scale / Math.max(0.001, initialScale) >=
            LABEL_ZOOM_THRESHOLD;
    }

    function shouldShowCityTitleBackground(group) {
        return !exporting &&
            (group.id === state.selectedId ||
                group.id === state.hoveredId);
    }

    function buildGroupSprite(group) {
        if (!Number.isFinite(group.width) ||
            !Number.isFinite(group.height) ||
            group.width <= 0 ||
            group.height <= 0) {
            group.sprite = null;
            group.spriteDirty = false;
            return;
        }
        const scale = SPRITE_SCALE;
        const padding = SPRITE_SHADOW_PADDING;
        const sprite = document.createElement('canvas');
        sprite.width = Math.max(1, Math.ceil(
            (group.width + padding * 2) * scale
        ));
        sprite.height = Math.max(1, Math.ceil(
            (group.height + padding * 2) * scale
        ));
        const spriteCtx = sprite.getContext('2d');
        spriteCtx.imageSmoothingEnabled = true;
        spriteCtx.imageSmoothingQuality = 'high';
        spriteCtx.setTransform(scale, 0, 0, scale, 0, 0);
        spriteCtx.translate(padding, padding);
        // 分组图层只保存稳定的图片和基础文字。悬停/选中态走轻量叠加层，
        // 否则鼠标在相邻城市之间移动时会反复重建整组照片画布。
        paintGroup(spriteCtx, group, true, false, false);
        group.sprite = sprite;
        group.spritePadding = padding;
        group.spriteDirty = false;
    }

    function drawLiveGroup(group) {
        ctx.save();
        ctx.translate(group.x, group.y);
        paintGroup(ctx, group, true, false, false);
        ctx.restore();
    }

    function drawGroupDetails(target, group) {
        const withLabels = shouldDrawFootprintLabels(group);
        const titleActive = shouldShowCityTitleBackground(group);
        if (!withLabels && !titleActive) return;
        target.save();
        target.translate(group.x, group.y);
        if (titleActive) drawCityTitle(target, group, true);
        if (withLabels) {
            group.labels.forEach(label => drawFootprintLabel(target, label));
        }
        target.restore();
    }

    function paintGroup(
        target, group, withImages, withLabels, titleActive
    ) {
        group.photoRects.forEach(rect => {
            drawImageCard(target, rect, withImages, false);
        });
        group.ticketRects.forEach(rect => {
            drawImageCard(target, rect, withImages, true);
        });
        if (group.ticketLabel) {
            target.fillStyle = theme().soft;
            target.font = '600 12px ' + fontText;
            target.textAlign = 'left';
            target.textBaseline = 'top';
            target.fillText(group.ticketLabel.text,
                group.ticketLabel.x, group.ticketLabel.y);
        }
        // 标注最后绘制，极窄的图片间隙中也能保持名称可读。
        drawCityTitle(target, group, titleActive);
        if (withLabels) {
            group.labels.forEach(label => drawFootprintLabel(target, label));
        }
    }

    function fillLabelBackdrop(target, x, y, width, height) {
        target.save();
        target.globalAlpha = 0.86;
        target.fillStyle = theme().background;
        roundRectPath(target, x - 3, y - 2, width + 6, height + 4, 4);
        target.fill();
        target.restore();
    }

    function drawCityTitle(target, group, showBackground) {
        target.textAlign = 'left';
        target.textBaseline = 'top';
        const cardX = group.cityLabel.x;
        const cardY = group.cityLabel.y;
        const cardWidth = group.cityLabel.width || 270;
        const cardHeight = 52;
        const textX = cardX + 10;
        const textWidth = Math.max(8, cardWidth - 20);
        if (showBackground) {
            target.save();
            roundRectPath(target, cardX, cardY, cardWidth, cardHeight, 2);
            target.shadowColor = theme().ambientShadow;
            target.shadowBlur = 10;
            target.shadowOffsetX = 2.5;
            target.shadowOffsetY = 4;
            target.globalAlpha = 0.94;
            target.fillStyle = theme().frame;
            target.fill();
            target.restore();
            target.save();
            roundRectPath(target, cardX, cardY, cardWidth, cardHeight, 2);
            target.shadowColor = theme().contactShadow;
            target.shadowBlur = 1.4;
            target.shadowOffsetY = 1;
            target.fillStyle = theme().frame;
            target.fill();
            target.restore();
            roundRectPath(target, cardX, cardY, cardWidth, cardHeight, 2);
            target.strokeStyle = theme().line;
            target.lineWidth = 0.8;
            target.stroke();
            target.fillStyle = theme().accent;
            roundRectPath(target, cardX + 5, cardY + 8, 2, 30, 1);
            target.fill();
        }

        target.font = '400 24px "快看世界体", "MiSans", "PingFang SC", sans-serif';
        const city = ellipsisText(
            target,
            group.city,
            textWidth
        );
        const meta = cityMetaText(group);
        target.font = '500 11px ' + fontText;
        const metaText = ellipsisText(
            target,
            meta,
            textWidth
        );
        target.fillStyle = theme().ink;
        target.font = '400 24px "快看世界体", "MiSans", "PingFang SC", sans-serif';
        if (!showBackground) {
            target.lineJoin = 'round';
            target.strokeStyle = theme().background;
            target.lineWidth = 3;
            target.strokeText(city, textX, cardY + 7);
        }
        target.fillText(city, textX, cardY + 7);
        target.fillStyle = theme().soft;
        target.font = '500 11px ' + fontText;
        if (!showBackground) {
            target.lineWidth = 2.5;
            target.strokeText(metaText, textX, cardY + 35);
        }
        target.fillText(metaText, textX, cardY + 35);
    }

    function drawFootprintLabel(target, label) {
        target.font = '600 12px ' + fontText;
        target.textAlign = 'left';
        target.textBaseline = 'top';
        const text = ellipsisText(target, label.text, label.width || groupTextWidth(label));
        if (label.overlay) {
            fillLabelBackdrop(
                target,
                label.x,
                label.y,
                Math.min(label.width || groupTextWidth(label),
                    target.measureText(text).width),
                16
            );
        }
        target.lineJoin = 'round';
        target.strokeStyle = theme().background;
        target.lineWidth = 2.2;
        target.fillStyle = theme().accent;
        target.strokeText(text, label.x, label.y);
        target.fillText(text, label.x, label.y);
    }

    function groupTextWidth(label) {
        return label.width || 180;
    }

    function ellipsisText(target, text, maxWidth) {
        if (target.measureText(text).width <= maxWidth) return text;
        let value = text;
        while (value.length > 2 && target.measureText(value + '…').width > maxWidth) {
            value = value.slice(0, -1);
        }
        return value + '…';
    }

    function drawImageCard(target, rect, withImages, ticket) {
        const item = rect.item;
        const x = rect.lx;
        const y = rect.ly;
        const width = rect.width;
        const height = rect.height;
        if (ticket) {
            if (withImages && item && item.sprite) {
                drawContainedImage(target, item.sprite, x, y, width, height);
            } else {
                target.fillStyle = theme().placeholder;
                target.fillRect(x, y, width, height);
                target.fillStyle = theme().soft;
                target.font = '500 9px ' + fontText;
                target.textAlign = 'center';
                target.textBaseline = 'middle';
                target.fillText(
                    item && item.status === 'error' ? '票根失败' : '加载中',
                    x + width / 2,
                    y + height / 2
                );
            }
            return;
        }
        const rotation = Number(rect.rotation) || 0;
        if (rotation) {
            target.save();
            target.translate(x + width / 2, y + height / 2);
            target.rotate(rotation * Math.PI / 180);
            target.translate(-(x + width / 2), -(y + height / 2));
        }
        const frameColor = theme().frame;
        const framePadding = sceneLayoutProfile().framePadding;
        roundRectPath(target, x, y, width, height, 2);
        target.save();
        target.shadowColor = theme().ambientShadow;
        target.shadowBlur = 12;
        target.shadowOffsetX = 3;
        target.shadowOffsetY = 5;
        target.globalAlpha = 0.82;
        target.fillStyle = frameColor;
        target.fill();
        target.restore();

        target.save();
        roundRectPath(target, x, y, width, height, 2);
        target.shadowColor = theme().contactShadow;
        target.shadowBlur = 1.4;
        target.shadowOffsetY = 1;
        target.fillStyle = frameColor;
        target.fill();
        target.restore();

        roundRectPath(target, x, y, width, height, 2);
        target.fillStyle = frameColor;
        target.fill();
        target.strokeStyle = theme().line;
        target.lineWidth = 0.8;
        target.stroke();

        target.save();
        target.strokeStyle = 'rgba(255, 255, 255, 0.72)';
        target.lineWidth = 0.75;
        target.beginPath();
        target.moveTo(x + 2.4, y + 0.65);
        target.lineTo(x + width - 2.4, y + 0.65);
        target.moveTo(x + 0.65, y + 2.4);
        target.lineTo(x + 0.65, y + height - 2.4);
        target.stroke();
        target.strokeStyle = 'rgba(35, 27, 21, 0.2)';
        target.beginPath();
        target.moveTo(x + 2.4, y + height - 0.65);
        target.lineTo(x + width - 2.4, y + height - 0.65);
        target.moveTo(x + width - 0.65, y + 2.4);
        target.lineTo(x + width - 0.65, y + height - 2.4);
        target.stroke();
        target.restore();

        const innerX = x + framePadding;
        const innerY = y + framePadding;
        const innerWidth = Math.max(1, width - framePadding * 2);
        const innerHeight = Math.max(1, height - framePadding * 2);
        roundRectPath(
            target,
            innerX,
            innerY,
            innerWidth,
            innerHeight,
            1.2
        );
        target.save();
        target.clip();
        if (withImages && item && item.sprite) {
            drawContainedImage(
                target,
                item.sprite,
                innerX,
                innerY,
                innerWidth,
                innerHeight
            );
        } else {
            target.fillStyle = theme().placeholder;
            target.fillRect(innerX, innerY, innerWidth, innerHeight);
            target.fillStyle = theme().soft;
            target.font = '500 9px ' + fontText;
            target.textAlign = 'center';
            target.textBaseline = 'middle';
            target.fillText(
                item && item.status === 'error' ? '图片失败' :
                    (item && item.status === 'loaded' && !withImages ? '' : '加载中'),
                innerX + innerWidth / 2,
                innerY + innerHeight / 2
            );
        }
        target.restore();
        roundRectPath(
            target,
            innerX,
            innerY,
            innerWidth,
            innerHeight,
            1.2
        );
        target.strokeStyle = 'rgba(32, 25, 20, 0.18)';
        target.lineWidth = 0.7;
        target.stroke();

        if (sceneStyleIs('scrapbook')) {
            paintTapeStrip(
                target,
                x + 4,
                y - 4,
                28,
                9,
                -8,
                0.86
            );
            paintTapeStrip(
                target,
                x + width - 32,
                y - 4,
                28,
                9,
                8,
                0.86
            );
        }
        if (rotation) target.restore();
    }

    function drawContainedImage(target, image, x, y, width, height) {
        const scale = Math.min(width / image.width, height / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        target.drawImage(
            image,
            x + (width - drawWidth) / 2,
            y + (height - drawHeight) / 2,
            drawWidth,
            drawHeight
        );
    }

    function drawMiniMap() {
        const cssWidth = 188;
        const cssHeight = 132;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (miniMapCanvas.width !== Math.round(cssWidth * dpr) ||
            miniMapCanvas.height !== Math.round(cssHeight * dpr)) {
            miniMapCanvas.width = Math.round(cssWidth * dpr);
            miniMapCanvas.height = Math.round(cssHeight * dpr);
        }
        const pad = 8;
        const scale = Math.min(
            (cssWidth - pad * 2) / scene.worldWidth,
            (cssHeight - pad * 2) / scene.worldHeight
        );
        const offsetX = (cssWidth - scene.worldWidth * scale) / 2;
        const offsetY = (cssHeight - scene.worldHeight * scale) / 2;
        miniMapView = { scale, offsetX, offsetY, cssWidth, cssHeight };

        miniMapCtx.setTransform(1, 0, 0, 1, 0, 0);
        miniMapCtx.clearRect(0, 0, miniMapCanvas.width, miniMapCanvas.height);
        miniMapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        miniMapCtx.fillStyle = theme().background;
        miniMapCtx.fillRect(0, 0, cssWidth, cssHeight);
        miniMapCtx.fillStyle = theme().accentSoft;
        miniMapCtx.fillRect(
            offsetX + scene.mapRect.x * scale,
            offsetY + scene.mapRect.y * scale,
            scene.mapRect.width * scale,
            scene.mapRect.height * scale
        );
        groups.forEach(group => {
            miniMapCtx.fillStyle = group.id === state.selectedId
                ? theme().accent
                : (group.id === state.hoveredId
                    ? theme().lineActive
                    : theme().placeholder);
            (group.components.length ? group.components : [group]).forEach(rect => {
                miniMapCtx.fillRect(
                    offsetX + rect.x * scale,
                    offsetY + rect.y * scale,
                    Math.max(2, rect.w * scale),
                    Math.max(2, rect.h * scale)
                );
            });
        });

        const worldLeft = -camera.x / camera.scale;
        const worldTop = -camera.y / camera.scale;
        const worldWidth = viewport.width / camera.scale;
        const worldHeight = viewport.height / camera.scale;
        miniMapCtx.strokeStyle = theme().accent;
        miniMapCtx.lineWidth = 1.4;
        miniMapCtx.strokeRect(
            offsetX + worldLeft * scale,
            offsetY + worldTop * scale,
            worldWidth * scale,
            worldHeight * scale
        );
    }

    function centerCameraFromMiniMap(event) {
        if (!miniMapView || interactionLocked()) return;
        const rect = miniMapCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const worldX = (x - miniMapView.offsetX) / miniMapView.scale;
        const worldY = (y - miniMapView.offsetY) / miniMapView.scale;
        camera.x = viewport.width / 2 - worldX * camera.scale;
        camera.y = viewport.height / 2 - worldY * camera.scale;
        clampCamera();
        dirty = true;
        scheduleDraw();
    }

    function roundRectPath(target, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        target.beginPath();
        target.moveTo(x + r, y);
        target.arcTo(x + width, y, x + width, y + height, r);
        target.arcTo(x + width, y + height, x, y + height, r);
        target.arcTo(x, y + height, x, y, r);
        target.arcTo(x, y, x + width, y, r);
        target.closePath();
    }

    function pointInRotatedRect(point, rect) {
        const dx = point.x - rect.centerX;
        const dy = point.y - rect.centerY;
        const angle = -(Number(rect.rotation) || 0) * Math.PI / 180;
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
        return Math.abs(localX) <= rect.width / 2 + 2 &&
            Math.abs(localY) <= rect.height / 2 + 2;
    }

    function hitTest(point) {
        const world = screenToWorld(point);
        for (let index = sceneTicketRects.length - 1; index >= 0; index--) {
            const ticket = sceneTicketRects[index];
            if (!pointInRotatedRect(world, ticket)) continue;
            return {
                group: {
                    id: 'ticket:' + ticket.key,
                    city: ticket.city || '票根'
                },
                photo: null,
                ticket,
                footprintCluster: null,
                pin: false
            };
        }
        const mediaRects = [];
        groups.forEach(group => {
            [...group.photoRects, ...group.ticketRects].forEach(rect => {
                mediaRects.push({ group, rect, z: Number(rect.z) || 0 });
            });
        });
        mediaRects.sort((a, b) => b.z - a.z);
        for (const entry of mediaRects) {
            const { group, rect } = entry;
            if (world.x >= rect.worldX &&
                world.x <= rect.worldX + rect.width &&
                world.y >= rect.worldY &&
                world.y <= rect.worldY + rect.height) {
                const footprintCluster = group.footprintClusters.find(cluster =>
                    cluster.key === rect.footprintId);
                return {
                    group,
                    photo: rect,
                    footprintCluster: footprintCluster || null,
                    pin: false
                };
            }
        }
        for (let index = groups.length - 1; index >= 0; index--) {
            const group = groups[index];
            const label = shouldDrawFootprintLabels(group)
                ? group.labels.find(item =>
                    world.x >= item.worldX &&
                    world.x <= item.worldX + item.width &&
                    world.y >= item.worldY &&
                    world.y <= item.worldY + 18
                )
                : null;
            if (label) {
                return {
                    group,
                    photo: null,
                    footprintCluster: group.footprintClusters.find(cluster =>
                        cluster.key === label.footprintId) || null,
                    pin: false
                };
            }
            if (group.titleRect &&
                world.x >= group.titleRect.x &&
                world.x <= group.titleRect.x + group.titleRect.w &&
                world.y >= group.titleRect.y &&
                world.y <= group.titleRect.y + group.titleRect.h) {
                return { group, photo: null, footprintCluster: null, pin: false };
            }
            const component = group.components.find(rect =>
                world.x >= rect.x && world.x <= rect.x + rect.w &&
                world.y >= rect.y && world.y <= rect.y + rect.h
            );
            if (component) {
                return { group, photo: null, footprintCluster: null, pin: false };
            }
            if (Math.hypot(world.x - group.pinX, world.y - group.pinY) <= 14) {
                return { group, photo: null, pin: true };
            }
        }
        return null;
    }

    function eventPoint(event) {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function onPointerDown(event) {
        if (state.previewPhoto || exporting || interactionLocked()) return;
        canvas.setPointerCapture(event.pointerId);
        prepareDragSnapshot();
        dragging = true;
        movedDuringDrag = false;
        activePointer = event.pointerId;
        lastPointer = eventPoint(event);
        canvas.classList.add('is-dragging');
    }

    function onPointerMove(event) {
        if (state.previewPhoto || exporting) return;
        if (interactionLocked()) {
            canvas.style.cursor = 'progress';
            return;
        }
        const point = eventPoint(event);
        if (!dragging || event.pointerId !== activePointer) {
            const hit = hitTest(point);
            const ticketHit = hit && hit.ticket ? hit.ticket : null;
            const next = hit && !ticketHit ? hit.group.id : '';
            const nextFootprint = hit && hit.footprintCluster
                ? {
                    groupId: hit.group.id,
                    footprintId: hit.footprintCluster.key,
                    cluster: hit.footprintCluster
                }
                : null;
            const nextPhoto = hit && hit.photo ? hit.photo : null;
            const footprintChanged =
                !state.hoveredFootprint !== !nextFootprint ||
                (state.hoveredFootprint && nextFootprint &&
                    state.hoveredFootprint.footprintId !== nextFootprint.footprintId);
            const photoChanged = state.hoveredPhoto !== nextPhoto;
            const ticketChanged =
                (state.hoveredTicket && state.hoveredTicket.key) !==
                (ticketHit && ticketHit.key);
            if (next !== state.hoveredId ||
                footprintChanged ||
                photoChanged ||
                ticketChanged) {
                state.hoveredId = next;
                state.hoveredFootprint = nextFootprint;
                state.hoveredPhoto = nextPhoto;
                state.hoveredTicket = ticketHit;
                dirty = true;
                scheduleDraw();
            }
            canvas.style.cursor = hit ? 'pointer' : 'grab';
            return;
        }
        const dx = point.x - lastPointer.x;
        const dy = point.y - lastPointer.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) movedDuringDrag = true;
        camera.x += dx;
        camera.y += dy;
        lastPointer = point;
        clampCamera();
        if (dragSnapshotActive) {
            updateDragSnapshot();
            return;
        }
        dirty = true;
        scheduleDraw();
    }

    function onPointerUp(event) {
        if (state.previewPhoto || exporting || interactionLocked()) return;
        const point = eventPoint(event);
        const hit = hitTest(point);
        if (dragging && !movedDuringDrag) {
            if (hit && hit.ticket) {
                state.hoveredTicket = null;
                openPreview(hit.ticket, hit.group);
            } else if (hit && hit.photo) openPreview(hit.photo, hit.group);
            else if (hit) selectGroup(hit.group.id);
            else selectGroup('');
        }
        clearDragSnapshot();
        dragging = false;
        activePointer = null;
        lastPointer = null;
        canvas.classList.remove('is-dragging');
        canvas.style.cursor = hit ? 'pointer' : 'grab';
        dirty = true;
        scheduleDraw();
    }

    function selectGroup(id) {
        state.selectedId = id || '';
        dirty = true;
        scheduleDraw();
    }

    function footprintPreviewPhotos(rectangle, group) {
        if (!rectangle || rectangle.kind === 'ticket' || !group) return [];
        const footprintId = rectangle.footprintId;
        const footprint = (group.footprints || []).find(item =>
            item.key === footprintId
        );
        if (footprint && Array.isArray(footprint.photos)) {
            const ordered = footprint.photos.map(item =>
                group.photoRects.find(rect =>
                    rect.footprintId === footprintId && rect.item === item
                )
            ).filter(Boolean);
            if (ordered.length) return ordered;
        }
        return group.photoRects.filter(rect =>
            rect.footprintId === footprintId
        );
    }

    function previewPhotoAspect(rectangle) {
        try {
            const expectedUrl = new URL(
                rectangle.item.url,
                window.location.href
            ).href;
            if (previewImage.currentSrc === expectedUrl &&
                previewImage.naturalWidth &&
                previewImage.naturalHeight) {
                return previewImage.naturalWidth / previewImage.naturalHeight;
            }
        } catch (error) {
            // Fall back to the wall thumbnail ratio.
        }
        const aspect = Number(rectangle && rectangle.item &&
            rectangle.item.aspect);
        return Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
    }

    function fitPreviewFrameToImage() {
        if (!state.previewPhoto) return;
        const figureStyle = window.getComputedStyle(previewFigure);
        const horizontalPadding =
            parseFloat(figureStyle.paddingLeft || '0') +
            parseFloat(figureStyle.paddingRight || '0');
        const verticalPadding =
            parseFloat(figureStyle.paddingTop || '0') +
            parseFloat(figureStyle.paddingBottom || '0');
        const aspect = previewPhotoAspect(state.previewPhoto);
        const maxFigureWidth = Math.max(180,
            Math.min(1120, viewport.width * 0.88));
        const maxImageWidth = Math.max(160,
            maxFigureWidth - horizontalPadding);
        const maxImageHeight = Math.max(160, viewport.height - 220);
        const maxFigureHeight = Math.max(240, viewport.height - 140);
        let width = Math.min(maxImageWidth, maxImageHeight * aspect);
        let height = width / aspect;
        for (let pass = 0; pass < 2; pass++) {
            previewImage.style.width =
                Math.ceil(width * 100) / 100 + 'px';
            previewImage.style.height =
                Math.ceil(height * 100) / 100 + 'px';
            previewFigure.style.width =
                Math.ceil((width + horizontalPadding) * 100) /
                100 + 'px';
            const captionHeight =
                previewFigure.querySelector('figcaption')
                    .getBoundingClientRect().height;
            const availableImageHeight = Math.max(120, Math.min(
                maxImageHeight,
                maxFigureHeight - verticalPadding - captionHeight - 6
            ));
            if (height <= availableImageHeight) break;
            height = availableImageHeight;
            width = height * aspect;
        }
        previewImage.style.aspectRatio = String(aspect);
    }

    function renderPreviewPhoto(rectangle) {
        state.previewPhoto = rectangle;
        previewImageReady = false;
        previewImage.classList.remove('is-ready');
        previewFigure.style.width = '';
        previewImage.alt =
            state.previewGroup.city + '，' + rectangle.footprint;
        previewTitle.textContent = rectangle.footprint;
        const footprint = (state.previewGroup.footprints || []).find(item =>
            item.key === rectangle.footprintId
        ) || (state.previewGroup.footprints || []).find(item =>
            item.name === rectangle.footprint
        );
        const description = String(
            footprint && footprint.description || ''
        ).trim();
        previewDescription.textContent = description;
        previewDescription.hidden = !description;
        const hasSequence = state.previewPhotos.length > 1;
        previewMeta.textContent =
            state.previewGroup.city + '，' + formatDate(rectangle.createTime) +
            (rectangle.kind === 'ticket' ? '，票根' : '') +
            (hasSequence
                ? '，' + (state.previewIndex + 1) + ' / ' +
                    state.previewPhotos.length
                : '');
        previewPrevBtn.hidden = !hasSequence;
        previewNextBtn.hidden = !hasSequence;
        previewPrevBtn.disabled = false;
        previewNextBtn.disabled = false;
        fitPreviewFrameToImage();
        previewImage.src = rectangle.item.url;
    }

    function previewScreenRect(rectangle) {
        const width = Math.max(1, rectangle.width * camera.scale);
        const height = Math.max(1, rectangle.height * camera.scale);
        const centerX = (rectangle.worldX + rectangle.width / 2) *
            camera.scale + camera.x;
        const centerY = (rectangle.worldY + rectangle.height / 2) *
            camera.scale + camera.y;
        return {
            left: centerX - width / 2,
            top: centerY - height / 2,
            width,
            height,
            rotation: Number(rectangle.rotation) || 0
        };
    }

    function previewImageScreenRect() {
        const rect = previewImage.getBoundingClientRect();
        return {
            left: rect.left,
            top: rect.top,
            width: Math.max(1, rect.width),
            height: Math.max(1, rect.height),
            rotation: 0
        };
    }

    function previewLayoutImageScreenRect() {
        const previousTransform = previewFigure.style.transform;
        previewFigure.style.transform = 'none';
        const rect = previewImageScreenRect();
        previewFigure.style.transform = previousTransform;
        return rect;
    }

    function paintPreviewTransition(rectangle) {
        const sprite = rectangle && rectangle.item &&
            rectangle.item.sprite;
        if (!sprite || !sprite.width || !sprite.height) return false;
        previewTransitionCanvas.width = sprite.width;
        previewTransitionCanvas.height = sprite.height;
        previewTransitionCtx.clearRect(
            0,
            0,
            previewTransitionCanvas.width,
            previewTransitionCanvas.height
        );
        previewTransitionCtx.drawImage(
            sprite,
            0,
            0,
            previewTransitionCanvas.width,
            previewTransitionCanvas.height
        );
        return true;
    }

    function placePreviewTransition(rect) {
        previewTransitionCanvas.style.left = rect.left + 'px';
        previewTransitionCanvas.style.top = rect.top + 'px';
        previewTransitionCanvas.style.width = rect.width + 'px';
        previewTransitionCanvas.style.height = rect.height + 'px';
        previewTransitionCanvas.style.transform =
            'rotate(' + rect.rotation + 'deg)';
    }

    function stopPreviewTransition() {
        if (previewTransitionAnimation) {
            previewTransitionAnimation.cancel();
            previewTransitionAnimation = null;
        }
        previewTransitionCanvas.classList.remove('is-active');
        previewTransitionCanvas.style.opacity = '';
    }

    function animatePreviewTransition(from, to, duration, easing, done, delay = 0) {
        stopPreviewTransition();
        placePreviewTransition(from);
        previewTransitionCanvas.classList.add('is-active');
        previewTransitionAnimation = previewTransitionCanvas.animate([
            {
                left: from.left + 'px',
                top: from.top + 'px',
                width: from.width + 'px',
                height: from.height + 'px',
                borderRadius: '6px',
                opacity: 1,
                transform: 'rotate(' + from.rotation + 'deg)'
            },
            {
                left: to.left + 'px',
                top: to.top + 'px',
                width: to.width + 'px',
                height: to.height + 'px',
                borderRadius: '10px',
                opacity: 1,
                transform: 'rotate(' + to.rotation + 'deg)'
            }
        ], {
            duration,
            easing,
            delay,
            fill: 'forwards'
        });
        const animation = previewTransitionAnimation;
        animation.finished.then(() => {
            if (previewTransitionAnimation !== animation) return;
            previewTransitionAnimation = null;
            done();
        }).catch(() => {
            // A newer preview action cancelled this transition.
        });
    }

    function revealPreviewImage(session) {
        if (session !== previewSession ||
            !previewOpenComplete ||
            !previewImageReady ||
            !state.previewPhoto) {
            return;
        }
        previewImage.classList.add('is-ready');
        if (!previewTransitionCanvas.classList.contains('is-active')) return;
        const animation = previewTransitionCanvas.animate([
            { opacity: 1 },
            { opacity: 0 }
        ], {
            duration: 200,
            easing: 'ease-out',
            fill: 'forwards'
        });
        previewTransitionAnimation = animation;
        animation.finished.then(() => {
            if (previewTransitionAnimation !== animation ||
                session !== previewSession) {
                return;
            }
            previewTransitionAnimation = null;
            previewTransitionCanvas.classList.remove('is-active');
            previewTransitionCanvas.style.opacity = '';
        }).catch(() => {
            // Closing during the crossfade takes over the canvas.
        });
    }

    function finishPreviewOpen(session) {
        if (session !== previewSession || !state.previewPhoto) return;
        previewOpenComplete = true;
        preview.classList.remove('is-opening');
        preview.classList.add('is-content-visible');
        revealPreviewImage(session);
    }

    function openPreview(rectangle, group) {
        if (!rectangle || !rectangle.item) return;
        const session = ++previewSession;
        previewOpenComplete = false;
        previewImageReady = false;
        state.previewGroup = group;
        state.previewPhotos = footprintPreviewPhotos(rectangle, group);
        state.previewIndex = Math.max(0, state.previewPhotos.indexOf(rectangle));
        preview.classList.remove(
            'is-closing',
            'is-content-visible',
            'is-opening'
        );
        preview.classList.add('show', 'is-opening');
        preview.setAttribute('aria-hidden', 'false');
        renderPreviewPhoto(rectangle);
        fitPreviewFrameToImage();
        const target = previewLayoutImageScreenRect();
        previewCloseBtn.focus();
        if (reduceMotion || !paintPreviewTransition(rectangle)) {
            finishPreviewOpen(session);
            return;
        }
        animatePreviewTransition(
            previewScreenRect(rectangle),
            target,
            600,
            'cubic-bezier(0.4, 0, 0.2, 1)',
            () => finishPreviewOpen(session),
            50
        );
    }

    function clearPreviewState() {
        state.previewPhoto = null;
        state.previewGroup = null;
        state.previewPhotos = [];
        state.previewIndex = 0;
        preview.classList.remove(
            'show',
            'is-opening',
            'is-content-visible',
            'is-closing'
        );
        preview.setAttribute('aria-hidden', 'true');
        previewImage.removeAttribute('src');
        previewImage.classList.remove('is-ready');
        previewFigure.style.width = '';
        previewImage.style.width = '';
        previewImage.style.height = '';
        previewImage.style.aspectRatio = '';
        previewDescription.textContent = '';
        previewDescription.hidden = true;
        previewPrevBtn.hidden = true;
        previewNextBtn.hidden = true;
        canvas.focus();
        dirty = true;
        scheduleDraw();
    }

    function closePreview() {
        if (!state.previewPhoto || preview.classList.contains('is-closing')) {
            return;
        }
        const session = ++previewSession;
        const rectangle = state.previewPhoto;
        previewOpenComplete = false;
        previewImageReady = false;
        preview.classList.remove('is-opening', 'is-content-visible');
        preview.classList.add('is-closing');
        const finish = () => {
            if (session !== previewSession) return;
            stopPreviewTransition();
            clearPreviewState();
        };
        if (reduceMotion || !paintPreviewTransition(rectangle)) {
            finish();
            return;
        }
        animatePreviewTransition(
            previewImageScreenRect(),
            previewScreenRect(rectangle),
            240,
            'cubic-bezier(0.4, 0, 1, 1)',
            finish
        );
    }

    function movePreview(direction) {
        if (!state.previewPhoto ||
            state.previewPhotos.length < 2 ||
            preview.classList.contains('is-opening') ||
            preview.classList.contains('is-closing')) {
            return;
        }
        const count = state.previewPhotos.length;
        state.previewIndex =
            (state.previewIndex + direction + count) % count;
        renderPreviewPhoto(state.previewPhotos[state.previewIndex]);
        previewImageReady = false;
        previewImage.classList.remove('is-ready');
    }

    function onWheel(event) {
        if (state.previewPhoto || exporting || interactionLocked()) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        const point = eventPoint(event);
        zoomAt(point.x, point.y, Math.exp(-event.deltaY * 0.0015));
    }

    function onKeyDown(event) {
        if (!root.classList.contains('show')) return;
        if (state.previewPhoto) {
            if (event.key === 'Escape') closePreview();
            return;
        }
        if (wallYearOpen && event.key === 'Escape') {
            event.preventDefault();
            setYearMenuOpen(false, true);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            if (state.immersive) {
                setImmersive(false);
                return;
            }
            closeTravelWall();
            return;
        }
        if (interactionLocked()) return;
        if (event.target instanceof HTMLButtonElement) return;
        if (event.key === '0') setFitView(true);
        else if (event.key === '+' || event.key === '=') {
            zoomAt(viewport.width / 2, viewport.height / 2, 1.16);
        } else if (event.key === '-') {
            zoomAt(viewport.width / 2, viewport.height / 2, 1 / 1.16);
        } else if (event.key === 'ArrowLeft') {
            camera.x += 80;
        } else if (event.key === 'ArrowRight') {
            camera.x -= 80;
        } else if (event.key === 'ArrowUp') {
            camera.y += 80;
        } else if (event.key === 'ArrowDown') {
            camera.y -= 80;
        } else {
            return;
        }
        event.preventDefault();
        clampCamera();
        dirty = true;
        scheduleDraw();
    }

    function updateSummary() {
        const footprintCount = groups.reduce((sum, group) => sum + group.footprintCount, 0);
        const photoCount = groups.reduce((sum, group) => sum + group.photoCount, 0);
        wallSummary.textContent = activeYearLabel() + '：' +
            groups.length + ' 座城市，' +
            footprintCount + ' 条足迹，' + photoCount + ' 张照片，' +
            sceneTickets.length + ' 张票根';
    }

    function countPhotoOverlaps() {
        const rects = [];
        groups.forEach(group => {
            [...group.photoRects, ...group.ticketRects].forEach(rect => {
                rects.push({
                    groupId: group.id,
                    x: group.x + rect.lx - 3,
                    y: group.y + rect.ly - 3,
                    width: rect.width + 6,
                    height: rect.height + 6
                });
            });
        });
        let count = 0;
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i];
                const b = rects[j];
                if (a.groupId === b.groupId) continue;
                if (a.x < b.x + b.width &&
                    a.x + a.width > b.x &&
                    a.y < b.y + b.height &&
                    a.y + a.height > b.y) {
                    count++;
                }
            }
        }
        return count;
    }

    function updateLoadingState() {
        if (loadingFinished) {
            updateInteractionLock(!sceneReady);
            return;
        }
        const total = queuedImages;
        const ratio = total ? finishedImages / total : 1;
        const passive = sceneReady && loadPlanReady;
        loadingState.classList.toggle('is-passive', passive);
        canvas.classList.toggle('is-loading', !sceneReady);
        updateInteractionLock(!sceneReady);
        if (!total) {
            if (!sceneReady) {
                setLoadingPhase(
                    '正在铺开旅行记忆',
                    activeYearLabel() + '，整理城市位置与画面',
                    18
                );
            }
            scheduleRelayout(true);
            return;
        }

        const detail = activeYearLabel() + ' · 照片 ' +
            finishedImages + ' / ' + total +
            (failedImages ? ' · 失败 ' + failedImages : '');
        if (finishedImages >= total && loadingImages === 0) {
            setLoadingPhase(
                '正在生成拖拽画面',
                detail + ' · 优化整墙浏览',
                92
            );
            scheduleRelayout(true);
        } else {
            setLoadingPhase(
                sceneReady ? '照片继续载入中' : '正在铺开旅行记忆',
                detail,
                18 + ratio * 66
            );
        }
    }

    function interactionLocked() {
        return !sceneReady;
    }

    function updateInteractionLock(locked) {
        body.classList.toggle('is-scene-locked', locked);
        body.setAttribute('aria-busy', String(locked));
        canvas.setAttribute('aria-disabled', String(locked));
        miniMapCanvas.setAttribute('aria-disabled', String(locked));
        miniMapCanvas.style.pointerEvents = locked ? 'none' : '';
        canvas.style.cursor = locked ? 'progress' : 'grab';

        const controls = [
            wallYearTrigger,
            immersiveBtn,
            zoomInBtn,
            zoomOutBtn,
            fitBtn,
            exportBtn,
            returnMapBtn,
            stressBtn
        ];
        controls.forEach(control => {
            control.disabled = locked || exporting ||
                (control === exportBtn && imagesLoading()) ||
                (control === stressBtn && !debugEnabled);
        });
        wallYearControl.classList.toggle(
            'is-disabled',
            wallYearTrigger.disabled
        );
        if (wallYearTrigger.disabled) setYearMenuOpen(false);

        if (locked) {
            dragging = false;
            activePointer = null;
            lastPointer = null;
            canvas.classList.remove('is-dragging');
            if (state.hoveredId ||
                state.hoveredFootprint ||
                state.hoveredPhoto ||
                state.hoveredTicket) {
                state.hoveredId = '';
                state.hoveredFootprint = null;
                state.hoveredPhoto = null;
                state.hoveredTicket = null;
                dirty = true;
                scheduleDraw();
            }
        }
    }

    function imagesLoading() {
        return loadingImages > 0 ||
            loadQueue.length > 0 ||
            (queuedImages > 0 && finishedImages < queuedImages);
    }

    function updateZoom() {
        const relative = Math.round((camera.scale / initialScale) * 100);
        if (zoomValue.textContent !== relative + '%') {
            zoomValue.textContent = relative + '%';
        }
    }

    function recordPerformance(now, frameMs) {
        if (!debugEnabled) return;
        if (!drawStart) drawStart = now;
        drawFrames++;
        drawTime += frameMs;
        if (now - drawStart > 500) {
            fps = Math.round(drawFrames * 1000 / (now - drawStart));
            const average = drawTime / drawFrames;
            debugText.textContent =
                (sceneBaseCache ? '场景缓存' : '实时布局') +
                '，完成 ' + finishedImages + ' / ' + queuedImages +
                '，' + average.toFixed(1) + ' ms，' + fps + ' fps';
            drawStart = now;
            drawFrames = 0;
            drawTime = 0;
        }
    }

    function assertExportTask(task) {
        if (task !== exportTask || exportCancelRequested) {
            const error = new Error('取消导出');
            error.name = 'ExportCancelled';
            throw error;
        }
    }

    async function waitForAllImages(task) {
        while (loadingImages > 0 || loadQueue.length > 0) {
            assertExportTask(task);
            const ratio = queuedImages ? finishedImages / queuedImages : 0;
            setExportProgress(3 + ratio * 15,
                '加载全部照片 ' + finishedImages + ' / ' + queuedImages);
            await new Promise(resolve => window.setTimeout(resolve, 80));
        }
        assertExportTask(task);
    }

    async function exportWall() {
        if (exporting) return;
        exporting = true;
        updateInteractionLock(false);
        exportCancelRequested = false;
        const task = ++exportTask;
        exportBtn.disabled = true;
        exportCancelBtn.disabled = false;
        exportProgress.hidden = false;
        setExportProgress(3, '加载全部照片');
        try {
            await waitForAllImages(task);
            ensureLayoutSettled();
            setExportProgress(18, '生成城市照片组');
            for (let index = 0; index < groups.length; index++) {
                assertExportTask(task);
                const group = groups[index];
                group.ready = group.mediaItems.every(item =>
                    item.status === 'loaded' || item.status === 'error'
                );
                if (group.ready) {
                    buildGroupSprite(group);
                }
                setExportProgress(
                    18 + ((index + 1) / groups.length) * 42,
                    '合成 ' + group.city + ' ' + (index + 1) + ' / ' + groups.length
                );
                await new Promise(resolve => window.setTimeout(resolve, 0));
            }

            const totalWorldHeight = scene.worldHeight;
            const contentWidth = scene.worldWidth;
            const exportWorldSide = Math.max(
                contentWidth,
                totalWorldHeight
            ) + EXPORT_SQUARE_PADDING * 2;
            const maxLongEdge = 8192;
            const maxPixels = 50 * 1024 * 1024;
            const scale = Math.min(
                maxLongEdge / exportWorldSide,
                Math.sqrt(maxPixels / (exportWorldSide * exportWorldSide))
            );
            const outputWidth = Math.max(1, Math.round(exportWorldSide * scale));
            const outputHeight = outputWidth;
            const contentOffsetX = (exportWorldSide - contentWidth) / 2;
            const contentOffsetY =
                (exportWorldSide - totalWorldHeight) / 2;
            setExportProgress(62,
                '生成 ' + outputWidth + ' × ' + outputHeight + ' PNG');
            await new Promise(resolve => requestAnimationFrame(resolve));
            assertExportTask(task);

            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = outputWidth;
            exportCanvas.height = outputHeight;
            const exportCtx = exportCanvas.getContext('2d');
            exportCtx.imageSmoothingEnabled = true;
            exportCtx.imageSmoothingQuality = 'high';
            exportCtx.fillStyle = theme().background;
            exportCtx.fillRect(0, 0, outputWidth, outputHeight);
            exportCtx.save();
            exportCtx.scale(scale, scale);
            exportCtx.translate(contentOffsetX, contentOffsetY);
            drawWorldContent(exportCtx, true);
            exportCtx.restore();
            setExportProgress(82, '编码 PNG');
            await new Promise(resolve => requestAnimationFrame(resolve));
            assertExportTask(task);
            const blob = await new Promise(resolve =>
                exportCanvas.toBlob(resolve, 'image/png')
            );
            if (!blob) throw new Error('浏览器未能生成 PNG');
            assertExportTask(task);
            window.__travelWallLastExport = {
                blob,
                width: outputWidth,
                height: outputHeight,
                size: blob.size
            };
            downloadBlob(blob);
            setExportProgress(100,
                '导出完成：' + outputWidth + ' × ' + outputHeight + '，' +
                (blob.size / 1024 / 1024).toFixed(1) + ' MB');
            window.setTimeout(() => {
                exportProgress.hidden = true;
            }, 1400);
        } catch (error) {
            if (error.name === 'ExportCancelled') {
                setExportProgress(100, '已取消导出');
            } else {
                setExportProgress(100, '导出失败：' + (error.message || '未知错误'));
            }
            window.setTimeout(() => {
                exportProgress.hidden = true;
            }, error.name === 'ExportCancelled' ? 700 : 2200);
        } finally {
            exporting = false;
            updateInteractionLock(!sceneReady);
            groups.forEach(group => {
                group.spriteDirty = true;
            });
            dirty = true;
            scheduleDraw();
            exportCancelBtn.disabled = false;
        }
    }

    function drawWorldContent(target, images) {
        paintStudioBoard(target);
        paintMapPaperBase(target);
        const mapLayer = buildMapLayer(state.theme);
        target.drawImage(
            mapLayer,
            scene.mapRect.x,
            scene.mapRect.y,
            scene.mapRect.width,
            scene.mapRect.height
        );
        paintMapPaperEdges(target);
        paintSceneHeading(target);
        groups.forEach(group => {
            const drawLink = (endX, endY, secondary) => {
                if (!Number.isFinite(endX) || !Number.isFinite(endY)) return;
                if (secondary) return;
                const midX = (group.pinX + endX) / 2;
                const midY = (group.pinY + endY) / 2;
                target.beginPath();
                target.moveTo(group.pinX, group.pinY);
                if (group.side === 'left' || group.side === 'right') {
                    target.bezierCurveTo(midX, group.pinY, midX, endY, endX, endY);
                } else {
                    target.bezierCurveTo(group.pinX, midY, endX, midY, endX, endY);
                }
                target.setLineDash(secondary ? [4, 5] : []);
                target.strokeStyle = theme().thread;
                target.lineWidth = secondary ? 0.9 : 1.35;
                target.globalAlpha = 0.82;
                target.stroke();
                target.globalAlpha = 1;
            };
            drawLink(group.lineEndX, group.lineEndY, false);
        });
        target.setLineDash([]);
        groups.forEach(group => {
            if (images && group.sprite) {
                const padding = group.spritePadding || 0;
                target.drawImage(
                    group.sprite,
                    group.x - padding,
                    group.y - padding,
                    group.width + padding * 2,
                    group.height + padding * 2
                );
            } else {
                target.save();
                target.translate(group.x, group.y);
                paintGroup(target, group, images, false, false);
                target.restore();
            }
            drawGroupDetails(target, group);
        });
        groups.forEach(group => {
            target.beginPath();
            target.arc(group.pinX, group.pinY, 7, 0, Math.PI * 2);
            target.fillStyle = theme().frame;
            target.fill();
            target.strokeStyle = theme().accent;
            target.lineWidth = 1.8;
            target.stroke();
        });
        paintSceneTickets(target);
        paintSceneMotto(target);
    }

    function setExportProgress(percent, text) {
        exportProgressText.textContent = text;
        exportProgressBar.style.width = percent + '%';
    }

    function downloadBlob(blob) {
        const date = new Date();
        const stamp = date.getFullYear() + '-' +
            String(date.getMonth() + 1).padStart(2, '0') + '-' +
            String(date.getDate()).padStart(2, '0');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = '旅行记忆墙-' + stamp + '.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    }

    function bindEvents() {
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('pointerleave', () => {
            if (interactionLocked()) return;
            if (!dragging &&
                (state.hoveredId ||
                    state.hoveredFootprint ||
                    state.hoveredPhoto ||
                    state.hoveredTicket)) {
                state.hoveredId = '';
                state.hoveredFootprint = null;
                state.hoveredPhoto = null;
                state.hoveredTicket = null;
                dirty = true;
                scheduleDraw();
            }
        });
        canvas.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('resize', resize);
        window.addEventListener('keydown', onKeyDown);
        wallYearTrigger.addEventListener('click', () => {
            setYearMenuOpen(!wallYearOpen);
        });
        wallYearTrigger.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            setYearMenuOpen(true);
        });
        wallYearMenu.addEventListener('click', event => {
            const option = event.target.closest('[role="option"]');
            if (!option) return;
            selectYearOption(option);
        });
        wallYearMenu.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveYearMenuFocus(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                const options = [
                    ...wallYearMenu.querySelectorAll('[role="option"]')
                ];
                const option = event.key === 'Home'
                    ? options[0] : options[options.length - 1];
                option?.focus({ preventScroll: true });
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setYearMenuOpen(false, true);
            } else if (event.key === 'Tab') {
                setYearMenuOpen(false);
            }
        });
        document.addEventListener('pointerdown', event => {
            if (wallYearOpen && !wallYearControl.contains(event.target)) {
                setYearMenuOpen(false);
            }
        });
        immersiveBtn.addEventListener('click', () => {
            setImmersive(!state.immersive);
        });
        immersiveExitBtn.addEventListener('click', () => {
            setImmersive(false);
        });
        zoomInBtn.addEventListener('click', () => {
            zoomAt(viewport.width / 2, viewport.height / 2, 1.18);
        });
        zoomOutBtn.addEventListener('click', () => {
            zoomAt(viewport.width / 2, viewport.height / 2, 1 / 1.18);
        });
        fitBtn.addEventListener('click', () => setFitView(true));
        exportBtn.addEventListener('click', exportWall);
        exportCancelBtn.addEventListener('click', () => {
            if (!exporting) return;
            exportCancelRequested = true;
            exportCancelBtn.disabled = true;
            exportProgressText.textContent = '正在取消导出';
        });
        returnMapBtn.addEventListener('click', () => {
            selectGroup('');
            setMapFocusedView(true);
        });
        miniMapCanvas.addEventListener('pointerdown', event => {
            miniMapCanvas.setPointerCapture(event.pointerId);
            centerCameraFromMiniMap(event);
        });
        miniMapCanvas.addEventListener('pointermove', event => {
            if (event.buttons === 1) centerCameraFromMiniMap(event);
        });
        previewCloseBtn.addEventListener('click', closePreview);
        previewPrevBtn.addEventListener('click', () => movePreview(-1));
        previewNextBtn.addEventListener('click', () => movePreview(1));
        previewImage.addEventListener('load', () => {
            window.requestAnimationFrame(fitPreviewFrameToImage);
            if (!state.previewPhoto) return;
            previewImageReady = true;
            revealPreviewImage(previewSession);
        });
        preview.addEventListener('click', event => {
            if (event.target === preview) closePreview();
        });
        stressBtn.addEventListener('click', () => {
            stressUntil = performance.now() + 3000;
            dirty = true;
            scheduleDraw();
            stressBtn.disabled = true;
            window.setTimeout(() => {
                stressUntil = 0;
                stressBtn.disabled = false;
            }, 3050);
        });
    }

    async function runDebugSelfTest() {
        while (imagesLoading()) {
            await new Promise(resolve => window.setTimeout(resolve, 100));
        }
        ensureLayoutSettled();
        const firstPhoto = groups.flatMap(group => group.photoRects)[0];
        const hit = firstPhoto ? hitTest({
            x: (firstPhoto.worldX + firstPhoto.width / 2) *
                camera.scale + camera.x,
            y: (firstPhoto.worldY + firstPhoto.height / 2) *
                camera.scale + camera.y
        }) : null;
        const hash1 = layoutMetrics && layoutMetrics.outputHash;
        layoutWorld(true);
        const hash2 = layoutMetrics && layoutMetrics.outputHash;
        layoutWorld(true);
        const hash3 = layoutMetrics && layoutMetrics.outputHash;
        const result = {
            deterministic: hash1 === hash2 && hash2 === hash3,
            hashes: [hash1, hash2, hash3],
            firstPhotoHit: !!(hit && hit.photo),
            hitCity: hit && hit.group ? hit.group.city : '',
            maxComponents: layoutMetrics.maxComponents,
            overlaps: layoutMetrics.overlaps,
            mapIntrusions: layoutMetrics.mapIntrusions,
            cityTitleOverlaps: layoutMetrics.cityTitleOverlaps,
            titlePhotoOverlaps: layoutMetrics.titlePhotoOverlaps,
            titleOwnPhotoOverlaps: layoutMetrics.titleOwnPhotoOverlaps,
            titleLabelOverlaps: layoutMetrics.titleLabelOverlaps,
            titleMapIntrusions: layoutMetrics.titleMapIntrusions,
            groupSpacingViolations:
                layoutMetrics.groupSpacingViolations,
            minGroupSpacing: layoutMetrics.minGroupSpacing
        };
        if (new URLSearchParams(window.location.search).get('export') === '1') {
            await exportWall();
            result.export = window.__travelWallLastExport ? {
                width: window.__travelWallLastExport.width,
                height: window.__travelWallLastExport.height,
                size: window.__travelWallLastExport.size
            } : null;
        }
        document.documentElement.dataset.selfTest =
            JSON.stringify(result);
    }

    function init() {
        state.sceneStyle = configuredWallStyle;
        state.theme = sceneThemeKey(state.sceneStyle);
        updateInteractionLock(true);
        if (debugEnabled) debugPanel.hidden = false;
        body.dataset.theme = state.theme;
        body.dataset.sceneStyle = state.sceneStyle;
        buildGroups();
        buildMapMask();
        bindEvents();
        resize();
        if (debugEnabled &&
            new URLSearchParams(window.location.search).get('fit') === '1') {
            setFitView(false);
        } else {
            setMapFocusedView(false);
        }
        if (debugEnabled) {
            const debugCity = new URLSearchParams(window.location.search)
                .get('city');
            if (debugCity) {
                const group = groups.find(item =>
                    item.city.indexOf(debugCity) >= 0);
                if (group) selectGroup(group.id);
            }
        }
        buildLoadPlan();
        if (debugEnabled &&
            new URLSearchParams(window.location.search).get('selftest') === '1') {
            runDebugSelfTest().catch(error => {
                document.documentElement.dataset.selfTest =
                    JSON.stringify({ error: error.message || String(error) });
            });
        }
        if (debugEnabled) {
            debugText.textContent = '正在加载照片';
            stressBtn.disabled = false;
        }
        window.__travelWallPrototype = {
            getStats() {
                return {
                    groups: groups.length,
                    footprints: groups.reduce((sum, group) => sum + group.footprintCount, 0),
                    photos: groups.reduce((sum, group) => sum + group.photoCount, 0),
                    tickets: sceneTickets.length,
                    theme: state.theme,
                    sceneStyle: state.sceneStyle,
                    hoveredFootprint: state.hoveredFootprint
                        ? state.hoveredFootprint.footprintId : '',
                    queuedImages,
                    finishedImages,
                    failedImages,
                    failedUrls: [...imageItems.values()]
                        .filter(item => item.status === 'error')
                        .map(item => item.url),
                    renderPixelRatio: viewport.dpr,
                    canvasPixels: canvas.width * canvas.height,
                    photoOverlaps: countPhotoOverlaps(),
                    layout: layoutMetrics,
                    fps,
                    frameMs: drawFrames ? drawTime / drawFrames : 0,
                    world: scene ? {
                        width: Math.round(scene.worldWidth),
                        height: Math.round(scene.worldHeight)
                    } : null,
                    lastExport: window.__travelWallLastExport ? {
                        width: window.__travelWallLastExport.width,
                        height: window.__travelWallLastExport.height,
                        size: window.__travelWallLastExport.size
                    } : null
                };
            },
            fitView: () => setFitView(false),
            focusMap: () => setMapFocusedView(false),
            exportWall,
            relayout: () => {
                layoutWorld(true);
                return layoutMetrics;
            },
            getLayoutSnapshot: () => ({
                viewport: { width: viewport.width, height: viewport.height },
                world: {
                    width: scene.worldWidth,
                    height: scene.worldHeight
                },
                mapRect: scene.mapRect,
                headingRect: sceneHeadingWorldRect(),
                view: {
                    camera: { ...camera },
                    fitScale,
                    initialScale,
                    insets: layoutSafeInsets()
                },
                metrics: layoutMetrics,
                groups: groups.map(group => ({
                    city: group.city,
                    rect: group.worldRect,
                    contentBounds: groupBounds(group),
                    titleRect: group.titleRect,
                    titleOverlay: !!group.cityLabel.overlay,
                    labels: group.labels.map(label => ({
                        text: label.text,
                        footprintId: label.footprintId,
                        x: label.worldX,
                        y: label.worldY,
                        width: label.width,
                        overlay: !!label.overlay
                    })),
                    components: group.components,
                    photos: group.photoRects.map(rect => ({
                        id: rect.id,
                        groupId: rect.groupId,
                        footprintId: rect.footprintId,
                        clusterId: rect.clusterId,
                        x: rect.worldX,
                        y: rect.worldY,
                        width: rect.width,
                        height: rect.height
                    }))
                }))
            }),
            focusCity: name => {
                const group = groups.find(item => item.city.indexOf(name) >= 0);
                if (group) selectGroup(group.id);
                return group ? group.city : '';
            },
            getCityLayout: name => {
                const group = groups.find(item => item.city.indexOf(name) >= 0);
                if (!group) return null;
                return {
                    city: group.city,
                    side: group.side,
                    columns: group.layoutColumns,
                    layoutType: group.layoutType,
                    candidates: group.columnCandidates,
                    components: group.components,
                    titleRect: group.titleRect,
                    rect: { x: group.x, y: group.y, width: group.width, height: group.height },
                    photos: group.photoRects.slice(0, 3).map(rect => ({
                        x: rect.worldX,
                        y: rect.worldY,
                        width: rect.width,
                        height: rect.height,
                        footprint: rect.footprint
                    }))
                };
            },
            firstPhotoScreen: name => {
                const group = groups.find(item => item.city.indexOf(name) >= 0);
                const photo = group && [...group.photoRects, ...group.ticketRects][0];
                if (!photo) return null;
                return {
                    x: (photo.worldX + photo.width / 2) * camera.scale + camera.x,
                    y: (photo.worldY + photo.height / 2) * camera.scale + camera.y
                };
            },
            stress: duration => {
                stressUntil = performance.now() + (duration || 3000);
                dirty = true;
                scheduleDraw();
            }
        };
    }

    async function initializeTravelWall() {
        const [loadedData] = await Promise.all([
            loadTravelWallData(),
            ensureMottoFontReady()
        ]);
        data = loadedData;
        wallData = loadedData;
        if (!data || !Array.isArray(data.footprints) || !data.footprints.length) {
            throw new Error('还没有可以铺到记忆墙上的足迹');
        }
        if (!data.geo) {
            throw new Error('中国地图轮廓数据不完整');
        }
        populateYearOptions();
        setLoadingPhase(
            '正在整理城市位置',
            activeYearLabel() + '，归类足迹、照片与票根',
            10
        );
        await new Promise(resolve => window.requestAnimationFrame(resolve));
        if (!root.classList.contains('show')) return;
        init();
        initialized = true;
    }

    function openTravelWall() {
        if (root.classList.contains('show')) return;
        clearDragSnapshot();
        if (gestureNote) gestureNote.classList.remove('is-dismissed');
        if (closeTimer) {
            window.clearTimeout(closeTimer);
            closeTimer = 0;
        }
        root.hidden = false;
        root.setAttribute('aria-hidden', 'false');
        document.body.classList.add('travel-wall-open');
        window.requestAnimationFrame(() => root.classList.add('show'));

        if (initialized) {
            window.setTimeout(() => {
                if (!root.classList.contains('show')) return;
                resize();
                buildLoadPlan();
                if (travelWallBack) travelWallBack.focus();
            }, 40);
            return;
        }
        if (initializationPromise) return;

        loadingState.classList.remove('is-hidden');
        loadingState.classList.remove('is-passive');
        loadingFinished = false;
        setLoadingPhase('正在准备旅行记忆墙', '读取足迹数据', 4);
        initializationPromise = initializeTravelWall()
            .catch(error => {
                loadingFinished = false;
                loadingState.classList.remove('is-hidden');
                setLoadingPhase(
                    '旅行记忆墙加载失败',
                    error.message || '请稍后重试',
                    100
                );
                console.error('[travel-wall] initialization failed', error);
            })
            .finally(() => {
                initializationPromise = null;
                if (initialized &&
                    root.classList.contains('show') &&
                    travelWallBack) {
                    window.setTimeout(() => {
                        if (root.classList.contains('show')) {
                            travelWallBack.focus();
                        }
                    }, 40);
                }
            });
    }

    function closeTravelWall() {
        if (!root.classList.contains('show')) return;
        if (state.previewPhoto) closePreview();
        stopPendingImageLoads();
        clearDragSnapshot();
        setYearMenuOpen(false);
        setImmersive(false, false);
        root.classList.remove('show');
        root.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('travel-wall-open');
        closeTimer = window.setTimeout(() => {
            closeTimer = 0;
            if (!root.classList.contains('show')) root.hidden = true;
        }, 320);
        if (directTravelWall) {
            window.location.assign('/footprints');
            return;
        }
        openButton?.focus();
    }

    if (directTravelWall) {
        window.requestAnimationFrame(openTravelWall);
    } else if (openButton) {
        openButton.addEventListener('click', () => {
            window.location.assign(travelWallPath);
        });
    }
    canvas.addEventListener('pointerdown', dismissGestureNote, { passive: true });
    canvas.addEventListener('wheel', dismissGestureNote, { passive: true });
    zoomInBtn.addEventListener('click', dismissGestureNote);
    zoomOutBtn.addEventListener('click', dismissGestureNote);
    if (travelWallBack) {
        travelWallBack.addEventListener('click', closeTravelWall);
    }
})();
