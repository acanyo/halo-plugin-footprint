/**
 * 创意覆盖层：时间胶囊 / 足迹洞察 / 旅行明信片。
 *
 * 三块都从城市卡片墙之上打开，卡片墙保持在下一层，关闭后回到原滚动位置，
 * 因此放在同一个模块里共享「叠在卡片墙之上」的层级约定与关闭顺序。
 *
 * 逐块职责：
 *   - 去年今天：找出「往年的今天」去过的足迹，逐张翻看；
 *   - 足迹洞察：把全部足迹算成卡片（含称号、成就、年度回顾），统计口径来自
 *     modules/footprints-insight.js，本模块只负责把数字渲染成 DOM；
 *   - 旅行明信片：把某座城市的照片 + 文案画到 canvas，导出/分享。
 *
 * 注入约定：可变的足迹数据一律用取值函数（FOOTPRINTS / cityList 会整体重建），
 * 素材与画布函数则直接传引用。
 */

import {
    insightAchievements,
    insightDerived,
    insightFallbackTitle,
    insightKm,
    insightMetrics,
    insightPlaceName,
    insightProvinceStats,
    insightSegmentStats,
    insightSentences,
    insightSpotDate,
    insightTimeStats,
    insightTitlesOf,
    insightTypeStats,
    insightYearStats
} from './footprints-insight.js';
import {
    ticketImageUrl,
    ticketItemsFromFootprints,
    wrapTicketLetterText,
    setTicketView
} from './ticket-gallery.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints                    () => Footprint[]
 * @param d.cityList                      () => [{city, ...}]
 * @param d.cityViewItems                 (ci) => Footprint[]
 * @param d.cityWallImages                (fp) => [{url}]
 * @param d.featureEnabled                (key) => boolean
 * @param d.formatCityDate                (value) => string
 * @param d.cityWallCardData              (ci) => object
 * @param d.openCityView                  (ci, triggerBtn) => void
 * @param d.setOverlayHidden              (el, hidden) => void
 * @param d.setCityWallProvinceFilter     (name) => void
 * @param d.closeCityWall / d.openCityWall / d.renderCityWall
 * @param d.cityWall / d.cityWallBack / d.cityWallBtn
 * @param d.cityWallInsightBtn / d.cityWallTimeCapsuleBtn / d.cityWallProvinceFilter
 */
export function setupCreativeOverlays(d) {
    deps = d;
}

// ================= 创意功能入口与覆盖层 =================
// 时间胶囊 / 足迹洞察 / 明信片预览都从城市卡片墙之上打开；
// 城市卡片墙保持在下一层，关闭新层后回到卡片墙原滚动位置。

export function refreshCityWallFeatureActions() {
    if (deps.cityWallTimeCapsuleBtn()) {
        deps.cityWallTimeCapsuleBtn().hidden =
            !deps.featureEnabled('enableTimeCapsule') || timeCapsuleItems().length === 0;
    }
    if (deps.cityWallInsightBtn()) {
        deps.cityWallInsightBtn().hidden = !deps.featureEnabled('enableInsight');
    }
}

function focusCityWallTop() {
    setTimeout(() => {
        if (deps.cityWallBack() && deps.cityWallBack().isConnected &&
            deps.cityWall().classList.contains('show')) {
            deps.cityWallBack().focus();
        }
    }, 260);
}

// ---------------- 去年今天 ----------------
export const timeCapsule = document.getElementById('timeCapsule');
const timeCapsuleBack = document.getElementById('timeCapsuleBack');
const timeCapsulePrev = document.getElementById('timeCapsulePrev');
const timeCapsuleNext = document.getElementById('timeCapsuleNext');
const timeCapsuleStats = document.getElementById('timeCapsuleStats');
const timeCapsuleBody = document.getElementById('timeCapsuleBody');
let timeCapsuleItemsCache = [];
let timeCapsuleIndex = 0;

function timeCapsuleItems() {
    const now = new Date();
    const today = String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
    return deps.footprints()
        .filter(fp => {
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fp.createTime || '');
            if (!m) return false;
            const year = Number(m[1]);
            const md = m[2] + '-' + m[3];
            return year < now.getFullYear() && md === today;
        })
        .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
}

function timeCapsuleTicketIndex(fp) {
    const items = ticketItemsFromFootprints();
    const byKey = fp.key ? items.findIndex(item => item.key === fp.key) : -1;
    return byKey >= 0 ? byKey : items.indexOf(fp);
}

function renderTimeCapsule() {
    const fp = timeCapsuleItemsCache[timeCapsuleIndex];
    timeCapsuleBody.innerHTML = '';
    timeCapsuleStats.textContent = timeCapsuleItemsCache.length
        ? timeCapsuleItemsCache.length + ' 条历史记录 · 第 ' + (timeCapsuleIndex + 1) + ' 条'
        : '';
    timeCapsulePrev.hidden = timeCapsuleItemsCache.length < 2;
    timeCapsuleNext.hidden = timeCapsuleItemsCache.length < 2;
    if (!fp) {
        timeCapsuleBody.textContent = '今天还没有属于过去的故事';
        return;
    }

    const article = document.createElement('article');
    article.className = 'capsule-card';
    const shot = document.createElement('div');
    shot.className = 'capsule-shot';
    const imgs = deps.cityWallImages(fp);
    if (imgs.length) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = imgs[0].url;
        img.alt = fp.name;
        shot.appendChild(img);
    } else {
        shot.classList.add('no-image');
        shot.textContent = fp.name ? fp.name.charAt(0) : '?';
    }
    article.appendChild(shot);

    const info = document.createElement('div');
    info.className = 'capsule-info';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'capsule-eyebrow';
    eyebrow.textContent = 'FOOTPRINT · ' + (fp.footprintType || '旅行');
    const name = document.createElement('h3');
    name.textContent = fp.name;
    const meta = document.createElement('p');
    meta.className = 'capsule-meta';
    meta.textContent = [fp.city, fp.province, deps.formatCityDate(fp.createTime), fp.address]
        .filter(Boolean).join(' · ');
    const desc = document.createElement('p');
    desc.className = 'capsule-desc';
    desc.textContent = fp.description || '那一天的旅途，被留在了这里。';
    const actions = document.createElement('div');
    actions.className = 'capsule-actions';
    const galleryBtn = document.createElement('button');
    galleryBtn.type = 'button';
    galleryBtn.textContent = '打开图片墙';
    galleryBtn.addEventListener('click', () => {
        const fpIndex = deps.footprints().indexOf(fp);
        const ci = fpIndex >= 0 ? deps.cityList().findIndex(city => city.indices.includes(fpIndex)) : -1;
        closeTimeCapsule(false);
        if (ci >= 0) deps.openCityView(ci, null);
    });
    actions.appendChild(galleryBtn);
    if (ticketImageUrl(fp.ticketImage)) {
        const ticketBtn = document.createElement('button');
        ticketBtn.type = 'button';
        ticketBtn.className = 'is-ticket';
        ticketBtn.textContent = '查看票根';
        ticketBtn.addEventListener('click', () => {
            const idx = timeCapsuleTicketIndex(fp);
            closeTimeCapsule(false);
            deps.closeCityWall(false);
            if (idx >= 0) setTicketView(true, idx, false);
        });
        actions.appendChild(ticketBtn);
    }
    info.append(eyebrow, name, meta, desc, actions);
    article.appendChild(info);
    timeCapsuleBody.appendChild(article);
}

function openTimeCapsule() {
    if (!deps.featureEnabled('enableTimeCapsule') || !timeCapsule) return;
    timeCapsuleItemsCache = timeCapsuleItems();
    if (!timeCapsuleItemsCache.length) return;
    timeCapsuleIndex = 0;
    renderTimeCapsule();
    timeCapsule.classList.add('show');
    deps.setOverlayHidden(timeCapsule, false);
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
        timeCapsuleBack.focus();
    }
}

export function closeTimeCapsule(returnFocus = true) {
    if (!timeCapsule || !timeCapsule.classList.contains('show')) return;
    timeCapsule.classList.remove('show');
    deps.setOverlayHidden(timeCapsule, true);
    if (returnFocus) focusCityWallTop();
}

// ---------------- 足迹洞察 ----------------
export const insightView = document.getElementById('insightView');
const insightBack = document.getElementById('insightBack');
const insightDeck = document.getElementById('insightDeck');
const insightDots = document.getElementById('insightDots');
const insightPageCount = document.getElementById('insightPageCount');
const insightPrevCard = document.getElementById('insightPrevCard');
const insightNextCard = document.getElementById('insightNextCard');
const insightTitleEl = document.getElementById('insightTitle');
let insightCards = [];
let insightCardIndex = 0;
let insightSentenceVariant = 0;   // 概览那句总结的说法序号
let insightYearIndex = 0;         // 年度回顾里选中的年份下标
let insightSentenceCache = [];    // 概览的几句总结，换说法时只换文字、不重建卡片
let insightTitleVariant = 0;      // 当前显示第几个称号
let insightTitleCache = [];       // 已解锁的称号（按稀缺度排），换称号时在这份列表里循环
const INSIGHT_TITLE_SLOTS = 13;   // 条件称号的总数，用来显示「已解锁 N / 13」





















// ---- 洞察卡：数据 -> DOM ----
function insightMetric(label, value, opts = {}) {
    return { label, value, hint: opts.hint || '', action: opts.action || null };
}

function insightMetricsDom(items, id) {
    const wrap = document.createElement('div');
    wrap.className = 'insight-metrics';
    if (id) wrap.id = id;
    items.forEach(item => {
        const node = document.createElement(item.action ? 'button' : 'div');
        node.className = 'insight-metric' + (item.action ? ' is-link' : '');
        if (item.action) {
            node.type = 'button';
            node.addEventListener('click', item.action);
        }
        const label = document.createElement('span');
        label.className = 'insight-metric-label';
        label.textContent = item.label;
        const value = document.createElement('strong');
        value.className = 'insight-metric-value';
        value.textContent = item.value;
        node.append(label, value);
        if (item.hint) {
            const hint = document.createElement('em');
            hint.className = 'insight-metric-hint';
            hint.textContent = item.hint;
            node.appendChild(hint);
        }
        wrap.appendChild(node);
    });
    return wrap;
}

// 12 个月分布条
function insightMonthsDom(months) {
    const wrap = document.createElement('div');
    wrap.className = 'insight-months';
    wrap.setAttribute('aria-hidden', 'true');
    const max = Math.max(1, ...months);
    months.forEach((count, i) => {
        const col = document.createElement('div');
        col.className = 'insight-month' +
            (count && count === max ? ' is-top' : '') +
            (count ? '' : ' is-empty');
        col.title = (i + 1) + ' 月 · ' + count + ' 次';
        const bar = document.createElement('span');
        bar.className = 'insight-month-bar';
        bar.style.setProperty('--month-ratio', String(count / max));
        const label = document.createElement('em');
        label.textContent = String(i + 1);
        col.append(bar, label);
        wrap.appendChild(col);
    });
    return wrap;
}

function insightChipsDom(chips) {
    const wrap = document.createElement('div');
    wrap.className = 'insight-chips';
    chips.forEach(chip => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'insight-chip' + (chip.className ? ' ' + chip.className : '') +
            (chip.active ? ' is-active' : '');
        btn.textContent = chip.text;
        btn.setAttribute('aria-pressed', chip.active ? 'true' : 'false');
        btn.addEventListener('click', chip.onClick);
        wrap.appendChild(btn);
    });
    return wrap;
}

function insightBadgesDom(badges) {
    const wrap = document.createElement('div');
    wrap.className = 'insight-badges';
    badges.forEach(item => {
        const row = document.createElement('div');
        row.className = 'insight-badge' + (item.done ? ' is-earned' : ' is-locked');
        const mark = document.createElement('span');
        mark.className = 'insight-badge-mark';
        mark.textContent = item.done ? '✓' : '·';
        const text = document.createElement('span');
        text.className = 'insight-badge-text';
        const name = document.createElement('strong');
        name.textContent = item.name;
        const desc = document.createElement('em');
        // 已点亮的给结果值（12 个省），没点亮的给「还差多少」——
        // 只写 6/24 的话得自己算还差几张
        const detail = item.done ? item.progress : (item.remaining || item.progress);
        desc.textContent = item.desc + (detail ? ' · ' + detail : '');
        text.append(name, desc);
        row.append(mark, text);
        wrap.appendChild(row);
    });
    return wrap;
}

function insightCardDom(card) {
    const section = document.createElement('section');
    section.className = 'insight-card';
    section.dataset.cardId = card.id;
    section.setAttribute('role', 'tabpanel');
    const kicker = document.createElement('p');
    kicker.className = 'insight-kicker';
    kicker.textContent = card.kicker;
    const headline = document.createElement('h3');
    headline.className = 'insight-headline';
    if (card.headlineId) headline.id = card.headlineId;
    headline.textContent = card.headline;
    section.append(kicker, headline);
    if (card.note) {
        const note = document.createElement('p');
        note.className = 'insight-card-note';
        note.textContent = card.note;
        section.appendChild(note);
    }
    if (card.chips && card.chips.length) section.appendChild(insightChipsDom(card.chips));
    if (card.months) section.appendChild(insightMonthsDom(card.months));
    if (card.metrics && card.metrics.length) section.appendChild(insightMetricsDom(card.metrics, card.metricsId));
    if (card.badges && card.badges.length) section.appendChild(insightBadgesDom(card.badges));
    return section;
}

function insightYearHeadline(item) {
    return item.year + ' 年 · ' + item.footprints + ' 次出发、' + item.cities + ' 座城市' +
        (item.km ? '，约 ' + insightKm(item.km) + ' 公里' : '') + '。';
}

function insightYearMetrics(item) {
    return [
        insightMetric('足迹', item.footprints + ' 次'),
        insightMetric('城市', item.cities + ' 座'),
        insightMetric('省份', item.provinces.length + ' 个'),
        insightMetric('照片', item.photos + ' 张'),
        insightMetric('票根', item.tickets + ' 张'),
        insightMetric('估算里程', item.km ? insightKm(item.km) + ' km' : '—'),
        insightMetric('到访月份', item.months + ' 个月'),
        insightMetric('到访季节', item.seasons.join('、') || '—')
    ];
}

function refreshInsightYearCard(index) {
    const years = insightYearStats(deps.footprints());
    if (!years.length) return;
    insightYearIndex = Math.max(0, Math.min(index, years.length - 1));
    const active = years[insightYearIndex];
    const headline = document.getElementById('insightYearHeadline');
    if (headline) headline.textContent = insightYearHeadline(active);
    const metrics = document.getElementById('insightYearMetrics');
    if (metrics) metrics.replaceWith(insightMetricsDom(insightYearMetrics(active), 'insightYearMetrics'));
    if (!insightDeck) return;
    [...insightDeck.querySelectorAll('.insight-year-chip')].forEach((chip, i) => {
        chip.classList.toggle('is-active', i === insightYearIndex);
        chip.setAttribute('aria-pressed', i === insightYearIndex ? 'true' : 'false');
    });
}

// 只换概览那句话，下面那张统计表保持原样：
// 以前是整张卡重建，统计表会跟着重放一次淡入动画
function swapInsightSentence() {
    if (!insightSentenceCache.length) return;
    insightSentenceVariant = (insightSentenceVariant + 1) % insightSentenceCache.length;
    const node = document.getElementById('insightOverviewHeadline');
    if (!node) return;
    node.classList.remove('is-swapping');
    void node.offsetWidth;   // 触发重排，让动画能重新播
    node.textContent = insightSentenceCache[insightSentenceVariant];
    node.classList.add('is-swapping');
}

// 换一个称号：只改成就卡那句和顶栏副标题，徽章表与卡片结构都不动。
// 称号在两个地方同时出现，所以必须一起更新，不然顶栏和卡里会对不上
function swapInsightTitle() {
    if (insightTitleCache.length < 2) return;
    insightTitleVariant = (insightTitleVariant + 1) % insightTitleCache.length;
    const next = insightTitleCache[insightTitleVariant];
    const node = document.getElementById('insightBadgeHeadline');
    if (node) {
        node.classList.remove('is-swapping');
        void node.offsetWidth;   // 触发重排，让动画能重新播
        node.textContent = '「' + next + '」';
        node.classList.add('is-swapping');
    }
    if (insightTitleEl) insightTitleEl.textContent = next;
}

// 点数字直达对应内容：票根墙 / 某座城市 / 某省
function insightOpenTicketWall() {
    closeInsight(false);
    setTicketView(true);
}

function insightOpenCity(cityName) {
    const ci = deps.cityList().findIndex(city => city.city === cityName);
    if (ci < 0) return;
    closeInsight(false);
    deps.openCityView(ci, null);
}

function insightFilterProvince(name) {
    if (!name) return;
    closeInsight(false);
    deps.setCityWallProvinceFilter(name);
}

function insightCardsData() {
    const m = insightMetrics();
    const time = insightTimeStats(deps.footprints());
    const province = insightProvinceStats(deps.footprints());
    const segment = insightSegmentStats(deps.footprints());
    const type = insightTypeStats(deps.footprints());
    const years = insightYearStats(deps.footprints());
    const derived = insightDerived(segment);
    const badges = insightAchievements(m, time, province, segment, derived);
    const titles = insightTitlesOf(m, time, province, segment, derived);
    insightTitleCache = titles;
    if (insightTitleVariant >= titles.length) insightTitleVariant = 0;
    const title = titles.length
        ? titles[insightTitleVariant % titles.length]
        : insightFallbackTitle(m);
    if (!deps.footprints().length) {
        return {
            title: '',
            cards: [{
                id: 'empty',
                kicker: 'TRAVEL SUMMARY',
                headline: '还没有足迹数据，出发后回来看看你的旅行洞察。',
                metrics: []
            }]
        };
    }
    const sentences = insightSentences(m, time, province, segment, { years, title });
    insightSentenceCache = sentences;
    if (insightSentenceVariant >= sentences.length) insightSentenceVariant = 0;
    const cards = [];

    // 1. 概览
    cards.push({
        id: 'overview',
        kicker: 'TRAVEL SUMMARY',
        headlineId: 'insightOverviewHeadline',
        headline: sentences[insightSentenceVariant % sentences.length],
        chips: [{
            text: '换一个说法',
            onClick: swapInsightSentence
        }],
        metrics: [
            insightMetric('足迹', m.footprintCount + ' 次', { action: () => closeInsight() }),
            insightMetric('城市', m.cityCount + ' 座', { action: () => closeInsight() }),
            insightMetric('票根', m.ticketCount + ' 张', { action: insightOpenTicketWall }),
            insightMetric('照片', m.photoCount + ' 张'),
            insightMetric('估算里程', m.distanceKm ? m.distanceKm.toLocaleString('zh-CN') + ' km' : '—'),
            insightMetric('出发季节', m.topSeason ? m.topSeason + '（' + m.topSeasonCount + ' 次）' : '—')
        ]
    });

    // 2. 时间
    if (time) {
        const spanText = time.spanYears > 0
            ? time.spanYears + ' 年 ' + time.restDays + ' 天'
            : time.spanDays + ' 天';
        cards.push({
            id: 'time',
            kicker: 'TIMELINE · 时间',
            headline: '第一次出发是在 ' + insightSpotDate(time.first) + ' 的' +
                insightPlaceName(time.first) + '，最近一次停在 ' + insightSpotDate(time.last) + ' 的' +
                insightPlaceName(time.last) + ' —— 这条路，你走了 ' + spanText + '。',
            months: time.months,
            metrics: [
                insightMetric('首次出发', insightSpotDate(time.first), { hint: insightPlaceName(time.first) }),
                insightMetric('最近一次', insightSpotDate(time.last), { hint: insightPlaceName(time.last) }),
                insightMetric('最常出发的月份', time.topMonth + ' 月 · ' + time.topMonthCount + ' 次'),
                insightMetric('出行过的月份', time.monthCount + ' 个月'),
                insightMetric('最长连续出行', time.monthStreak + ' 个月'),
                insightMetric('旅行跨度', spanText)
            ]
        });
    }

    // 3. 省份：点某个省 → 回到卡片墙并只看这个省
    if (province.total) {
        cards.push({
            id: 'province',
            kicker: 'PROVINCES · 省份',
            headline: province.total + ' 个省份、' + m.cityCount + ' 座城市，' +
                province.list[0].name + '留下了你最多的脚印。',
            metrics: province.list.slice(0, 9).map(item => insightMetric(
                item.name,
                item.cities + ' 座城市 · ' + item.footprints + ' 个足迹',
                { action: () => insightFilterProvince(item.name) }
            ))
        });
    }

    // 4. 距离与方位：点城市进对应图片墙
    if (segment.count) {
        const longest = segment.longest;
        const shortest = segment.shortest;
        cards.push({
            id: 'segment',
            kicker: 'DISTANCE · 距离',
            headline: '最长的一次远行，是从' + insightPlaceName(longest.from) + '到' +
                insightPlaceName(longest.to) + '，约 ' + insightKm(longest.km) + ' 公里。',
            metrics: [
                insightMetric('最长一段', insightKm(longest.km) + ' km', {
                    hint: insightPlaceName(longest.from) + ' → ' + insightPlaceName(longest.to),
                    action: () => insightOpenCity(longest.to.city)
                }),
                insightMetric('最短一段', insightKm(shortest.km) + ' km', {
                    hint: insightPlaceName(shortest.from) + ' → ' + insightPlaceName(shortest.to)
                }),
                insightMetric('平均每段', insightKm(segment.average) + ' km'),
                insightMetric('累计里程', insightKm(segment.totalKm) + ' km'),
                insightMetric('最北', insightPlaceName(segment.north), {
                    action: () => insightOpenCity(segment.north.city)
                }),
                insightMetric('最南', insightPlaceName(segment.south), {
                    action: () => insightOpenCity(segment.south.city)
                }),
                insightMetric('最东', insightPlaceName(segment.east), {
                    action: () => insightOpenCity(segment.east.city)
                }),
                insightMetric('最西', insightPlaceName(segment.west), {
                    action: () => insightOpenCity(segment.west.city)
                })
            ]
        });
    }

    // 5. 类型与季节交叉
    if (type.list.length) {
        const top = type.list[0];
        cards.push({
            id: 'type',
            kicker: 'TYPES · 主题',
            headline: '「' + top.name + '」出现了 ' + top.count + ' 次' +
                (top.season
                    ? '，' + top.season + '天的风里，你出发得最多。'
                    : '，是你写得最多的一页。'),
            metrics: type.list.slice(0, 9).map(item => insightMetric(
                item.name,
                item.count + ' 次',
                { hint: item.season ? '多在' + item.season + '天（' + item.seasonCount + ' 次）' : '' }
            ))
        });
    }

    // 6. 年度回顾：卡内切换年份
    if (years.length) {
        if (insightYearIndex >= years.length) insightYearIndex = 0;
        const active = years[insightYearIndex];
        cards.push({
            id: 'year',
            kicker: 'YEAR IN REVIEW · 年度回顾',
            headlineId: 'insightYearHeadline',
            headline: insightYearHeadline(active),
            chips: years.map((item, i) => ({
                text: item.year + ' 年',
                className: 'insight-year-chip',
                active: i === insightYearIndex,
                onClick: () => refreshInsightYearCard(i)
            })),
            metricsId: 'insightYearMetrics',
            metrics: insightYearMetrics(active)
        });
    }

    // 7. 称号与轻成就
    if (badges.length) {
        cards.push({
            id: 'badge',
            kicker: 'ACHIEVEMENTS · 称号与成就',
            headlineId: 'insightBadgeHeadline',
            headline: '「' + title + '」',
            note: titles.length ? '已解锁 ' + titles.length + ' / ' + INSIGHT_TITLE_SLOTS + ' 个称号' : '',
            chips: titles.length > 1 ? [{ text: '换一个称号', onClick: swapInsightTitle }] : [],
            badges
        });
    }

    return { title, cards };
}

function renderInsightDots() {
    const single = insightCards.length < 2;
    if (insightDots) {
        insightDots.innerHTML = '';
        insightDots.hidden = single;
        insightCards.forEach((card, i) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'insight-dot' + (i === insightCardIndex ? ' is-active' : '');
            dot.setAttribute('role', 'tab');
            dot.setAttribute('aria-selected', i === insightCardIndex ? 'true' : 'false');
            dot.setAttribute('aria-label', '第 ' + (i + 1) + ' 张：' + card.kicker);
            dot.addEventListener('click', () => showInsightCard(i));
            insightDots.appendChild(dot);
        });
    }
    // 「3 / 7」：一眼看清在第几张、总共几张，点一下看下一张
    if (insightPageCount) {
        insightPageCount.hidden = single;
        insightPageCount.textContent = (insightCardIndex + 1) + ' / ' + insightCards.length;
        insightPageCount.setAttribute('aria-label',
            '第 ' + (insightCardIndex + 1) + ' 张，共 ' + insightCards.length + ' 张，点击看下一张');
    }
}

function showInsightCard(index) {
    if (!insightDeck || !insightCards.length) return;
    insightCardIndex = (index + insightCards.length) % insightCards.length;
    [...insightDeck.children].forEach((el, i) => {
        el.classList.toggle('is-active', i === insightCardIndex);
    });
    renderInsightDots();
    // 翻页后回到顶部，避免长卡片停在中间（真正滚动的是 feature-body）
    const scroller = insightView.querySelector('.feature-body');
    if (scroller && scroller.scrollTop) scroller.scrollTop = 0;
}

function renderInsight() {
    if (!insightDeck) return;
    const data = insightCardsData();
    insightCards = data.cards;
    if (insightTitleEl) insightTitleEl.textContent = data.title || '';
    insightDeck.innerHTML = '';
    insightCards.forEach(card => insightDeck.appendChild(insightCardDom(card)));
    if (insightCardIndex >= insightCards.length) insightCardIndex = 0;
    const single = insightCards.length < 2;
    if (insightPrevCard) insightPrevCard.hidden = single;
    if (insightNextCard) insightNextCard.hidden = single;
    showInsightCard(insightCardIndex);
}

function openInsight() {
    if (!deps.featureEnabled('enableInsight') || !insightView) return;
    // 说法序号不重置：关掉再打开会接着上一句往下走，而不是每次都被拉回同一句
    insightCardIndex = 0;
    insightYearIndex = 0;
    renderInsight();
    insightView.classList.add('show');
    deps.setOverlayHidden(insightView, false);
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
        insightBack.focus();
    }
}

export function closeInsight(returnFocus = true) {
    if (!insightView || !insightView.classList.contains('show')) return;
    insightView.classList.remove('show');
    deps.setOverlayHidden(insightView, true);
    if (returnFocus) focusCityWallTop();
}

// ---------------- 旅行明信片 ----------------
export const postcardPreview = document.getElementById('postcardPreview');
const postcardBack = document.getElementById('postcardBack');
const postcardTitle = document.getElementById('postcardTitle');
const postcardPreviewImg = document.getElementById('postcardPreviewImg');
const postcardDownload = document.getElementById('postcardDownload');
const postcardShare = document.getElementById('postcardShare');
const postcardStage = document.getElementById('postcardStage');
const postcardStatus = document.getElementById('postcardStatus');
const postcardRetry = document.getElementById('postcardRetry');
let postcardCi = -1;
let postcardBlobUrl = '';
let postcardFileName = '旅行明信片.png';

if (typeof CanvasRenderingContext2D !== 'undefined' &&
    !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        r = Math.min(r || 0, w / 2, h / 2);
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
    };
}

function cityPostcardData(ci) {
    const city = deps.cityList()[ci];
    return {
        city: city ? city.city : '未知城市',
        province: '',
        ...deps.cityWallCardData(ci)
    };
}

export function loadPostcardImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        // 强制走 CORS 模式：万一图片又跳到别的域名，加载会失败而不是悄悄把 canvas 污染掉
        // （canvas 一旦被污染，后面 toBlob 会直接抛 SecurityError，写信就整张出不来）
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = canvasSafeImageUrl(url);
    });
}

/**
 * 票根图可能放在别的域名（图床 / CDN，本地开发时页面域名和图片域名也常常不同）。
 * 跨域图既会被 CORS 拦掉，画进 canvas 之后也没法导出（toBlob 抛 SecurityError），
 * 所以跨域图统一走插件的同源代理 /footprints/image-proxy。
 */
export function canvasSafeImageUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url, window.location.href);
        if (parsed.origin === window.location.origin) return url;
        return '/footprints/image-proxy?url=' + encodeURIComponent(parsed.href);
    } catch (e) {
        return url;
    }
}

// 城市小结：以真实照片为主角，讲"我和这座城市的关系"（第一次去 / 最近一次 / 走过的地方），
// 不再是城市卡片墙那张卡的信息截图
function postcardCanvas(data, image) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1440;
    const ctx = canvas.getContext('2d');
    const ink = '#35423d';
    const muted = '#8b7865';
    const accent = '#9b704e';

    const bg = ctx.createLinearGradient(0, 0, 0, 1440);
    bg.addColorStop(0, '#e8e0d2');
    bg.addColorStop(1, '#d9cfbd');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1080, 1440);
    ctx.strokeStyle = 'rgba(118,92,61,0.32)';
    ctx.lineWidth = 3;
    ctx.strokeRect(28, 28, 1024, 1384);

    ctx.fillStyle = accent;
    ctx.font = '600 30px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CITY POSTCARD · 旅行明信片', 540, 118);

    const cityName = data.city || '';
    ctx.fillStyle = ink;
    ctx.font = cityName.length > 6
        ? '400 72px "PingFang SC", "Microsoft YaHei", serif'
        : '400 96px "PingFang SC", "Microsoft YaHei", serif';
    ctx.fillText(cityName, 540, 216);

    const subline = [data.province, data.count ? data.count + ' 个足迹' : ''].filter(Boolean).join(' · ');
    if (subline) {
        ctx.fillStyle = muted;
        ctx.font = '30px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText(subline, 540, 270);
    }

    // 真实照片当主角：cover 满铺 + clip，不垫底、不留白边
    const photoX = 42;
    const photoW = 996;
    const photoTop = 318;
    const photoH = 600;
    if (image) {
        const scale = Math.max(photoW / image.width, photoH / image.height);
        const dw = image.width * scale;
        const dh = image.height * scale;
        ctx.save();
        ctx.beginPath();
        ctx.rect(photoX, photoTop, photoW, photoH);
        ctx.clip();
        ctx.drawImage(image, photoX + (photoW - dw) / 2, photoTop + (photoH - dh) / 2, dw, dh);
        ctx.restore();
    } else {
        const g = ctx.createLinearGradient(photoX, photoTop, photoX + photoW, photoTop + photoH);
        g.addColorStop(0, '#cdbfa6');
        g.addColorStop(1, '#b09a7d');
        ctx.fillStyle = g;
        ctx.fillRect(photoX, photoTop, photoW, photoH);
        ctx.fillStyle = 'rgba(255,253,247,0.9)';
        ctx.font = '400 220px "Noto Serif SC", "Songti SC", serif';
        ctx.fillText((data.city || '?').charAt(0), 540, photoTop + photoH * 0.62);
    }

    // 第一次去 / 最近一次：这张小结真正多出来的信息
    ctx.fillStyle = muted;
    ctx.font = '24px "PingFang SC", "Microsoft YaHei", serif';
    ctx.fillText('第一次去', 320, 1002);
    ctx.fillText('最近一次', 760, 1002);
    ctx.fillStyle = ink;
    ctx.font = '34px ui-monospace, Consolas, monospace';
    ctx.fillText(data.first ? deps.formatCityDate(data.first) : '—', 320, 1050);
    ctx.fillText(data.latest ? deps.formatCityDate(data.latest) : '—', 760, 1050);

    ctx.strokeStyle = 'rgba(118,92,61,0.24)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(140, 1104);
    ctx.lineTo(940, 1104);
    ctx.stroke();

    // 走过的地方：这座城市里到过的足迹名
    const places = (data.places || []).join(' · ');
    if (places) {
        ctx.fillStyle = muted;
        ctx.font = '24px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText('走过的地方', 540, 1154);
        ctx.fillStyle = ink;
        ctx.font = '30px "PingFang SC", "Microsoft YaHei", serif';
        wrapTicketLetterText(ctx, places, 860).slice(0, 2).forEach((line, i) => {
            ctx.fillText(line, 540, 1210 + i * 46);
        });
    }

    ctx.fillStyle = muted;
    ctx.font = '26px "PingFang SC", "Microsoft YaHei", serif';
    ctx.fillText(
        data.count + ' 个足迹 · ' + data.photos + ' 张照片 · ' + data.tickets + ' 张票根',
        540, 1330
    );

    ctx.fillStyle = muted;
    ctx.font = '24px "PingFang SC", "Microsoft YaHei", serif';
    ctx.fillText('旅行记忆 · Travel Memory', 540, 1380);
    return canvas;
}

export function postcardToBlob(canvas) {
    return new Promise(resolve => {
        try {
            canvas.toBlob(blob => resolve(blob), 'image/png');
        } catch (e) {
            resolve(null);
        }
    });
}

// 明信片页三种状态：loading（骨架 + 文案）/ ready（出图 + 可下载）/ error（说明 + 重新生成）
function setPostcardState(state) {
    if (postcardStage) {
        postcardStage.classList.toggle('is-loading', state === 'loading');
        postcardStage.classList.toggle('is-ready', state === 'ready');
        postcardStage.classList.toggle('is-error', state === 'error');
        postcardStage.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    }
    if (postcardStatus) {
        postcardStatus.textContent = state === 'loading'
            ? '正在生成明信片…'
            : (state === 'error' ? '这张明信片没能生成，可能是城市照片取不到。' : '');
    }
    if (postcardRetry) postcardRetry.hidden = state !== 'error';
    if (postcardDownload) postcardDownload.disabled = state !== 'ready';
}

async function renderPostcardPreview() {
    if (postcardBlobUrl) URL.revokeObjectURL(postcardBlobUrl);
    const data = cityPostcardData(postcardCi);
    postcardTitle.textContent = data.city + ' · 旅行明信片';
    const city = deps.cityList()[postcardCi];
    data.province = city ? deps.cityViewItems(postcardCi).map(fp => fp.province).find(Boolean) || '' : '';
    if (postcardShare) postcardShare.hidden = true;
    setPostcardState('loading');
    // 明信片是拿去下载/分享的成品图，用未经"缩略图替换规则"处理的原始地址；
    // 城市卡片墙继续用小图（cover），翻页才轻快
    const coverUrl = data.coverRaw || data.cover;
    const image = coverUrl ? await loadPostcardImage(coverUrl) : null;
    let canvas = postcardCanvas(data, image);
    let blob = await postcardToBlob(canvas);
    if (!blob) {
        canvas = postcardCanvas(data, null);
        blob = await postcardToBlob(canvas);
    }
    if (!blob) {
        setPostcardState('error');
        return;
    }
    postcardBlobUrl = URL.createObjectURL(blob);
    postcardPreviewImg.src = postcardBlobUrl;
    setPostcardState('ready');
    const ts = (data.latest || '').replace(/-/g, '');
    postcardFileName = data.city + '-' + (ts || 'postcard') + '-旅行明信片.png';
    postcardShare.hidden = !(
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [new File([blob], postcardFileName, { type: 'image/png' })] })
    );
}

export async function openPostcard(ci, triggerBtn) {
    if (!deps.featureEnabled('enablePostcard') || !deps.cityList()[ci] || !postcardPreview) return;
    postcardCi = ci;
    setPostcardState('loading');
    postcardPreviewImg.removeAttribute('src');
    postcardPreview.classList.add('show');
    deps.setOverlayHidden(postcardPreview, false);
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
        postcardBack.focus();
    }
    await renderPostcardPreview();
}

export function closePostcard(returnFocus = true) {
    if (!postcardPreview || !postcardPreview.classList.contains('show')) return;
    postcardPreview.classList.remove('show');
    deps.setOverlayHidden(postcardPreview, true);
    postcardPreviewImg.removeAttribute('src');
    setPostcardState('loading');   // 下次打开从骨架态开始
    if (postcardBlobUrl) {
        URL.revokeObjectURL(postcardBlobUrl);
        postcardBlobUrl = '';
    }
    postcardCi = -1;
    if (returnFocus) focusCityWallTop();
}

function downloadPostcard() {
    if (!postcardBlobUrl) return;
    const a = document.createElement('a');
    a.href = postcardBlobUrl;
    a.download = postcardFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

async function sharePostcard() {
    if (!postcardBlobUrl) return;
    const blob = await fetch(postcardBlobUrl).then(r => r.blob());
    const file = new File([blob], postcardFileName, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: postcardFileName });
        } catch (e) { /* 用户取消分享无需处理 */ }
    }
}


/**
 * 绑定三块覆盖层的全部交互。必须在 setupCreativeOverlays 之后调用一次。
 */
export function initCreativeOverlays() {
    if (deps.cityWallTimeCapsuleBtn()) deps.cityWallTimeCapsuleBtn().addEventListener('click', openTimeCapsule);
    if (deps.cityWallInsightBtn()) deps.cityWallInsightBtn().addEventListener('click', openInsight);
    timeCapsuleBack.addEventListener('click', () => closeTimeCapsule());
    timeCapsulePrev.addEventListener('click', () => {
        if (timeCapsuleItemsCache.length < 2) return;
        timeCapsuleIndex = (timeCapsuleIndex - 1 + timeCapsuleItemsCache.length) % timeCapsuleItemsCache.length;
        renderTimeCapsule();
    });
    timeCapsuleNext.addEventListener('click', () => {
        if (timeCapsuleItemsCache.length < 2) return;
        timeCapsuleIndex = (timeCapsuleIndex + 1) % timeCapsuleItemsCache.length;
        renderTimeCapsule();
    });
    insightBack.addEventListener('click', () => closeInsight());
    if (insightPrevCard) insightPrevCard.addEventListener('click', () => showInsightCard(insightCardIndex - 1));
    if (insightNextCard) insightNextCard.addEventListener('click', () => showInsightCard(insightCardIndex + 1));
    if (insightPageCount) insightPageCount.addEventListener('click', () => showInsightCard(insightCardIndex + 1));
    // 洞察卡左右翻页也支持键盘
    document.addEventListener('keydown', event => {
        if (!insightView || !insightView.classList.contains('show')) return;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            showInsightCard(insightCardIndex - 1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            showInsightCard(insightCardIndex + 1);
        }
    });
    postcardBack.addEventListener('click', () => closePostcard());
    postcardDownload.addEventListener('click', downloadPostcard);
    postcardShare.addEventListener('click', sharePostcard);
    postcardRetry.addEventListener('click', () => { renderPostcardPreview(); });
    [timeCapsule, insightView, postcardPreview].forEach(overlay => {
        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                if (overlay === timeCapsule) closeTimeCapsule();
                else if (overlay === insightView) closeInsight();
                else closePostcard();
            }
        });
    });

    deps.cityWallBtn().addEventListener('click', deps.openCityWall);
    deps.cityWallBack().addEventListener('click', () => deps.closeCityWall());
    if (deps.cityWallProvinceFilter()) {
        deps.cityWallProvinceFilter().addEventListener('click', () => deps.setCityWallProvinceFilter(''));
    }
    // 数据重新加载（如刷新直达）后，若卡片墙正处于打开状态则重建
    document.addEventListener('footprints:loaded', () => {
        if (deps.cityWall() && deps.cityWall().classList.contains('show')) deps.renderCityWall();
    });

}
