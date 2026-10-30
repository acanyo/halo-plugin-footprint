/**
 * 足迹洞察：把全部足迹算成一叠卡片（概览、时间、省份、距离、主题、年度回顾、称号与成就）。
 *
 * 从 creative-overlays.js 拆出。统计口径来自 modules/footprints-insight.js，
 * 本模块只负责把数字渲染成 DOM、翻页，以及点数字直达对应内容。
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
import { setTicketView } from './ticket-gallery.js';
import { focusCityWallTop } from './city-wall.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints                    () => Footprint[]
 * @param d.cityList                      () => [{city, ...}]
 * @param d.featureEnabled                (key) => boolean
 * @param d.openCityView                  (ci, triggerBtn) => void
 * @param d.setOverlayHidden              (el, hidden) => void
 * @param d.setCityWallProvinceFilter     (name) => void
 */
export function setupInsightView(d) {
    deps = d;
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

export function openInsight() {
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

/**
 * 绑定洞察卡的翻页（按钮、页码、左右方向键）。由 initCreativeOverlays 按原顺序调用。
 */
export function initInsightView() {
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

}
