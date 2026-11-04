/**
 * 前台“我的旅途集”全屏覆盖层。
 *
 * 负责列表、详情、深链、分享和成员入口；地图高亮与路线由宿主注入。
 */

import {
    groupDistanceText,
    resolveFootprintGroups,
    wishStatusRank
} from './footprint-group-model.js';
import { formatLatitude, formatLongitude } from './survey-format.js';

const view = document.getElementById('footprintGroupsView');
const mapDock = document.getElementById('footprintGroupMapDock');
const returnButton = document.getElementById('footprintGroupReturn');
const mapDockType = document.getElementById('footprintGroupMapType');
const mapDockTitle = document.getElementById('footprintGroupMapTitle');
const mapDockStation = document.getElementById('footprintGroupMapStation');
const mapDockProgress = document.getElementById('footprintGroupMapProgress');
const mapDockMeta = document.getElementById('footprintGroupMapMeta');
const mapDockMeter = document.getElementById('footprintGroupMapMeter');
const mapDockPrev = document.getElementById('footprintGroupMapPrev');
const mapDockNext = document.getElementById('footprintGroupMapNext');
const mapDockExit = document.getElementById('footprintGroupMapExit');
const mapSceneModeButton = document.getElementById('footprintGroupMapSceneMode');
const liveRegion = document.getElementById('footprintGroupsLive');
const globeButton = document.getElementById('footprintGroupsBtn');
const mapButton = document.getElementById('groupGalleryBtn2d');

const MEMBER_PAGE_SIZE = 24;
const BACKGROUND_INERT_IDS = ['topNav', 'view-3d', 'view-2d', 'backGlobeBtn', 'cityFillFloatBtn'];
const BACKGROUND_CLICK_SLOP = 6;
const UPDATED_AT_ANNOTATION = 'footprint.lik.cc/updated-at';

let deps = null;
let groups = [];
let wishes = [];
let activeFilter = 'all';
let wishStatusFilter = 'all';
let listSort = 'ordered';
let searchQuery = '';
let activeGroup = null;
let activeWish = null;
let relatedWishReturn = null;
let activeFromMap = false;
let triggerElement = null;
let copied = false;
let listScrollTop = 0;
let listFocusKey = '';
let detailScrollTop = 0;
let detailFocusKey = '';
let visibleMemberCount = MEMBER_PAGE_SIZE;
let mapMemberIndex = 0;
let mapMemberActivated = false;
let mapFocusTimer = 0;
let deepLinkError = '';
let announceTimer = 0;
let inertSnapshot = [];
let backgroundPointerStart = null;
let wishLayerVisible = false;
let wishLayerMapMode = false;

function announce(message) {
    if (!liveRegion) return;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
        liveRegion.textContent = '';
        requestAnimationFrame(() => {
            liveRegion.textContent = message;
        });
    }, 40);
}

function setBackgroundInert(inert) {
    if (inert) {
        if (inertSnapshot.length) return;
        inertSnapshot = BACKGROUND_INERT_IDS.map(id => {
            const element = document.getElementById(id);
            return element ? { element, inert: element.inert } : null;
        }).filter(Boolean);
        inertSnapshot.forEach(item => { item.element.inert = true; });
    } else {
        if (!inertSnapshot.length) return;
        inertSnapshot.forEach(item => { item.element.inert = item.inert; });
        inertSnapshot = [];
    }
}

function focusableElements(root) {
    if (!root) return [];
    return [...root.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.hidden && element.getClientRects().length > 0);
}

function hasTextSelection() {
    const selection = window.getSelection();
    return !!selection && selection.rangeCount > 0 &&
        !selection.isCollapsed && selection.toString().trim().length > 0;
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function safeLink(value) {
    const link = String(value || '').trim();
    if (/^https?:\/\//i.test(link) || /^\//.test(link)) return link;
    return '';
}

async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('复制失败');
}

function formatDate(value, withTime = false) {
    const dateOnly = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return `${dateOnly[1]}.${dateOnly[2]}.${dateOnly[3]}`;
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return '时间未知';
    const parts = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {})
    }).formatToParts(date);
    const pick = type => parts.find(part => part.type === type)?.value || '';
    const dateText = [pick('year'), pick('month'), pick('day')].join('.');
    return withTime ? `${dateText} ${pick('hour')}:${pick('minute')}` : dateText;
}

function rangeText(group) {
    if (!group.range.start) return '尚无访问时间';
    const start = formatDate(group.range.start);
    const end = formatDate(group.range.end);
    return start === end ? `${start}，共 1 天` : `${start} - ${end}，共 ${group.range.days} 天`;
}

function cardRangeText(group) {
    if (!group.range.start) return '尚无访问时间';
    const start = formatDate(group.range.start);
    const end = formatDate(group.range.end);
    if (start === end) return `${start}，1 天`;
    if (start.slice(0, 4) === end.slice(0, 4)) {
        return `${start.slice(5)} - ${end.slice(5)}，${group.range.days} 天`;
    }
    return `${start} - ${end}，${group.range.days} 天`;
}

function collectionRecentText(group) {
    return group.range.end ? `最近收录 ${formatDate(group.range.end)}` : '尚无收录时间';
}

function typeText(group) {
    return group.groupType === 'trip' ? '旅程' : '收藏';
}

function progressText(group) {
    if (group.groupType !== 'collection' || !group.targetCount) return `${group.members.length} 条足迹`;
    return `已收录 ${group.members.length} / 目标 ${group.targetCount}`;
}

function rawMemberImage(member) {
    const first = deps.cityWallImages(member)[0];
    return first ? first.url : '';
}

function memberThumbnail(member) {
    const first = deps.cityWallImages(member)[0];
    return first ? deps.cityCardImageUrl(first.url) : '';
}

function refreshResolvedGroups() {
    groups = resolveFootprintGroups(
        deps.groups(),
        deps.footprints(),
        {
            publicOnly: true,
            imageUrlOf: rawMemberImage,
            imagesOf: member => deps.cityWallImages(member)
        }
    );
    wishes = (deps.wishes?.() || []).filter(wish =>
        wish && wish.metadata && wish.spec &&
        !wish.metadata.deletionTimestamp &&
        (!wish.spec.visibility || wish.spec.visibility === 'public')
    );
}

const WISH_STATUS_LABELS = {
    wish: '心愿',
    planning: '计划中',
    booked: '已订票',
    visited: '已实现'
};

function wishStatusText(wish) {
    return WISH_STATUS_LABELS[wish?.spec?.status] || '心愿';
}

function wishPlanText(wish) {
    const year = Number(wish?.spec?.plannedYear);
    const month = Number(wish?.spec?.plannedMonth);
    const note = String(wish?.spec?.plannedTimeNote || '').trim();
    const date = Number.isFinite(year) && year > 0
        ? `${year} 年${Number.isFinite(month) && month > 0 ? ` ${month} 月` : ''}`
        : '';
    return [date, note].filter(Boolean).join('，') || '计划时间待定';
}

function wishRegionText(wish) {
    return [wish?.spec?.province, wish?.spec?.city].filter(Boolean).join(' / ') ||
        wish?.spec?.address || '位置已记录';
}

function wishCoordinateText(wish) {
    const lng = Number(wish?.spec?.longitude);
    const lat = Number(wish?.spec?.latitude);
    return Number.isFinite(lng) && Number.isFinite(lat)
        ? `${formatLatitude(lat)}，${formatLongitude(lng)}`
        : '坐标未知';
}

function wishUpdatedAt(wish) {
    return String(
        wish?.metadata?.annotations?.[UPDATED_AT_ANNOTATION] ||
        wish?.metadata?.updateTimestamp ||
        wish?.metadata?.creationTimestamp ||
        ''
    );
}

function groupUpdatedAt(group) {
    return String(
        group.metadata?.annotations?.[UPDATED_AT_ANNOTATION] ||
        group.metadata?.updateTimestamp ||
        group.range.end ||
        group.metadata.creationTimestamp || '');
}

function wishMatchesSearch(wish, keyword) {
    if (!keyword) return true;
    return [
        wish.spec.title,
        wish.spec.description,
        wish.spec.address,
        wish.spec.province,
        wish.spec.city,
        ...(Array.isArray(wish.spec.tags) ? wish.spec.tags : [])
    ]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(keyword));
}

function filteredGroups() {
    const keyword = searchQuery.trim().toLowerCase();
  const filtered = groups.filter(group => {
        if (activeFilter !== 'all' && group.groupType !== activeFilter) return false;
        if (!keyword) return true;
        return [
            group.title,
            group.description,
            ...group.footprintTypes,
            ...group.members.flatMap(member => [member.name, member.city, member.province])
        ]
            .filter(Boolean)
            .some(value => String(value).toLowerCase().includes(keyword));
    });
  if (listSort === 'title') {
    return filtered.slice().sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.title.localeCompare(b.title, 'zh-Hans-CN');
    });
  }
  if (listSort === 'recent') {
    return filtered.slice().sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return String(b.range.end || b.metadata.creationTimestamp || '').localeCompare(
        String(a.range.end || a.metadata.creationTimestamp || '')
      );
    });
  }
  return filtered;
}

function filterCounts() {
    return {
        all: groups.length + wishes.length,
        trip: groups.filter(group => group.groupType === 'trip').length,
        collection: groups.filter(group => group.groupType === 'collection').length,
        wish: wishes.length
    };
}

function filteredWishes() {
    const keyword = searchQuery.trim().toLowerCase();
    const filtered = wishes.filter(wish =>
        (wishStatusFilter === 'all' || wish.spec.status === wishStatusFilter) &&
        wishMatchesSearch(wish, keyword)
    );
    return filtered.slice().sort((a, b) => {
        const statusA = wishStatusRank(a.spec.status);
        const statusB = wishStatusRank(b.spec.status);
        if (statusA !== statusB) return statusA - statusB;
        if (!!a.spec.pinned !== !!b.spec.pinned) return a.spec.pinned ? -1 : 1;
        if (listSort === 'title') {
            return a.spec.title.localeCompare(b.spec.title, 'zh-Hans-CN');
        }
        if (listSort === 'recent') {
            return wishUpdatedAt(b).localeCompare(wishUpdatedAt(a));
        }
        const orderA = a.spec.sortOrder == null ? Number.MAX_SAFE_INTEGER : Number(a.spec.sortOrder);
        const orderB = b.spec.sortOrder == null ? Number.MAX_SAFE_INTEGER : Number(b.spec.sortOrder);
        if (orderA !== orderB) return orderA - orderB;
        const planA = a.spec.plannedYear
            ? Number(a.spec.plannedYear) * 100 + (Number(a.spec.plannedMonth) || 0)
            : Number.MAX_SAFE_INTEGER;
        const planB = b.spec.plannedYear
            ? Number(b.spec.plannedYear) * 100 + (Number(b.spec.plannedMonth) || 0)
            : Number.MAX_SAFE_INTEGER;
        return planA - planB || wishUpdatedAt(b).localeCompare(wishUpdatedAt(a));
    });
}

function allListEntries() {
    const keyword = searchQuery.trim().toLowerCase();
    const entries = [
        ...groups
            .filter(group => {
                if (!keyword) return true;
                return [
                    group.title,
                    group.description,
                    ...group.footprintTypes,
                    ...group.members.flatMap(member => [member.name, member.city, member.province])
                ]
                    .filter(Boolean)
                    .some(value => String(value).toLowerCase().includes(keyword));
            })
            .map(group => ({
                kind: 'group',
                key: group.key,
                title: group.title,
                pinned: group.pinned,
                sortOrder: group.sortOrder,
                updatedAt: groupUpdatedAt(group),
                data: group
            })),
        ...wishes
            .filter(wish => wishMatchesSearch(wish, keyword))
            .map(wish => ({
                kind: 'wish',
                key: wish.metadata.name,
                title: wish.spec.title,
                pinned: wish.spec.pinned === true,
                sortOrder: wish.spec.sortOrder,
                statusRank: wishStatusRank(wish.spec.status),
                updatedAt: wishUpdatedAt(wish),
                data: wish
            }))
    ];
    return entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'group' ? -1 : 1;
        if (a.kind === 'wish' && a.statusRank !== b.statusRank) {
            return a.statusRank - b.statusRank;
        }
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (listSort === 'title') {
            return a.title.localeCompare(b.title, 'zh-Hans-CN');
        }
        if (listSort !== 'recent') {
            const orderA = a.sortOrder == null ? Number.MAX_SAFE_INTEGER : Number(a.sortOrder);
            const orderB = b.sortOrder == null ? Number.MAX_SAFE_INTEGER : Number(b.sortOrder);
            if (orderA !== orderB) return orderA - orderB;
        }
        return b.updatedAt.localeCompare(a.updatedAt) ||
            a.title.localeCompare(b.title, 'zh-Hans-CN');
    });
}

function cardHtml(group) {
    return group.groupType === 'trip' ? tripCardHtml(group) : collectionCardHtml(group);
}

function groupChipsHtml(group) {
    const types = group.footprintTypes
        .map(type => `<span class="group-chip">${escapeHtml(type)}</span>`)
        .join('');
    return types ? `<div class="group-library-types">${types}</div>` : '';
}

function groupInitial(group, member) {
    return (member?.city || member?.name || group.title || '旅').slice(0, 1);
}

function groupPreviewImageUrls(group, limit = 3) {
    const urls = [];
    const seen = new Set();
    for (const member of group.members) {
        for (const image of deps.cityWallImages(member)) {
            const url = image?.url;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            urls.push(url);
            if (urls.length >= limit) return urls;
        }
    }
    return urls;
}

function groupMemberPreviewImageUrls(group, limit = 4) {
    const urls = [];
    const seen = new Set();
    for (const member of group.members) {
        const image = deps.cityWallImages(member).find(item => item?.url && !seen.has(item.url));
        if (!image) continue;
        seen.add(image.url);
        urls.push(image.url);
        if (urls.length >= limit) break;
    }
    return urls;
}

function collectionPreviewHtml(group) {
    const cover = groupPreviewImageUrls(group, 1)
        .map(url => deps.cityCardImageUrl(url))[0];
    return `
        <div class="group-card-cover group-card-cover--collection">
            ${cover
                ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" style="--group-cover-focus: ${escapeHtml(group.coverFocus)}">`
                : `<span aria-hidden="true">${escapeHtml(groupInitial(group, group.members[0]))}</span>`}
        </div>`;
}

function tripCardHtml(group) {
    const first = group.members[0];
    const last = group.members[group.members.length - 1];
    return `
        <article class="group-library-card group-library-card--trip">
            <button type="button" class="group-library-card-hit" data-group-key="${escapeHtml(group.key)}"
                aria-label="打开旅程路线：${escapeHtml(group.title)}"></button>
            <div class="group-card-cover group-card-cover--trip">
                ${group.cover
                    ? `<img src="${escapeHtml(group.cover)}" alt="" loading="lazy" style="--group-cover-focus: ${escapeHtml(group.coverFocus)}">`
                    : `<span aria-hidden="true">${escapeHtml(groupInitial(group, first))}</span>`}
            </div>
            <div class="group-card-body">
                <span class="group-card-label">旅程</span>
                <h3>${escapeHtml(group.title)}</h3>
                ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ''}
                <div class="group-trip-summary" aria-hidden="true">
                    <span><small>起点</small><b>${escapeHtml(first?.name || '待定')}</b></span>
                    <i></i>
                    <span><small>终点</small><b>${escapeHtml(last?.name || '待定')}</b></span>
                    <em>${group.members.length} 站</em>
                </div>
            </div>
            <footer class="group-card-footer">
                <span>${escapeHtml(cardRangeText(group))}</span>
                <span>${group.cityCount} 座城市，直线约 ${Math.round(group.distanceKm).toLocaleString('zh-CN')} 公里</span>
                <span class="group-library-card-open">打开路线 <i aria-hidden="true">→</i></span>
            </footer>
        </article>`;
}

function collectionCardHtml(group) {
    const target = Math.max(group.targetCount || group.members.length, group.members.length, 1);
    const progress = Math.min(100, Math.round(group.members.length / target * 100));
    return `
        <article class="group-library-card group-library-card--collection">
            <button type="button" class="group-library-card-hit" data-group-key="${escapeHtml(group.key)}"
                aria-label="打开主题收藏：${escapeHtml(group.title)}"></button>
            ${collectionPreviewHtml(group)}
            <div class="group-card-body">
                <div class="group-collection-card-heading">
                    <span class="group-card-label">主题收藏</span>
                    <b>${group.members.length} 份</b>
                </div>
                <h3>${escapeHtml(group.title)}</h3>
                ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ''}
                <div class="group-collection-progress"
                    role="progressbar" aria-label="收藏完成度"
                    aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${group.members.length}">
                    <span><b>${escapeHtml(progressText(group))}</b><i>${progress}%</i></span>
                    <em style="--group-collection-progress: ${progress}%"></em>
                </div>
            </div>
            <footer class="group-card-footer">
                <span>${escapeHtml(collectionRecentText(group))}</span>
                <span>${group.cityCount} 座城市</span>
                <span class="group-library-card-open">翻看收藏 <i aria-hidden="true">→</i></span>
            </footer>
        </article>`;
}

function wishCardHtml(wish) {
    const realized = wish.spec.status === 'visited';
    const tags = Array.isArray(wish.spec.tags) ? wish.spec.tags : [];
    return `
        <article class="group-library-card group-library-card--wish"
            data-wish-status="${escapeHtml(wish.spec.status || 'wish')}">
            <button type="button" class="group-library-card-hit" data-wish-key="${escapeHtml(wish.metadata.name)}"
                aria-label="打开未来足迹：${escapeHtml(wish.spec.title)}"></button>
            <div class="group-card-body group-wish-card-body">
                <div class="group-wish-card-head">
                    <span class="group-wish-status">${escapeHtml(wishStatusText(wish))}</span>
                    ${wish.spec.pinned ? '<span class="group-chip">置顶</span>' : ''}
                </div>
                <h3>${escapeHtml(wish.spec.title)}</h3>
                <p class="group-wish-region">${escapeHtml(wishRegionText(wish))}</p>
                ${wish.spec.description
                    ? `<p>${escapeHtml(wish.spec.description)}</p>`
                    : ''}
                ${tags.length
                    ? `<div class="group-library-types">${tags
                        .map(tag => `<span class="group-chip">${escapeHtml(tag)}</span>`)
                        .join('')}</div>`
                    : ''}
                <div class="group-wish-meta">
                    <span>${escapeHtml(wishPlanText(wish))}</span>
                    ${realized
                        ? `<span>${wish.spec.realizedFootprintName || wish.spec.realizedGroupName
                            ? '已关联实现记录'
                            : '等待关联足迹'}</span>`
                        : ''}
                    <strong>查看地点 <i aria-hidden="true">→</i></strong>
                </div>
            </div>
        </article>`;
}

function listItemsHtml() {
    if (deepLinkError === 'unavailable') {
        return `<div class="group-library-empty" role="alert">
            <h3>记录不存在或尚未公开</h3>
            <p>这个链接可能已被删除、改为私密，或者地址不完整。</p>
            <button type="button" class="fp-btn" data-clear-deep-link>查看全部旅途集</button>
        </div>`;
    }
    const items = activeFilter === 'all' ? allListEntries() : filteredGroups();
    const wishItems = filteredWishes();
    const total = activeFilter === 'wish' ? wishItems.length : items.length;
    if (!total) {
        return `<div class="group-library-empty">
            <h3>${groups.length || wishes.length ? '没有符合筛选的记录' : '还没有旅程、收藏或未来足迹'}</h3>
            <p>${groups.length || wishes.length
                ? '切换到其他类型看看。'
                : '在后台创建第一段旅程、主题收藏或未来足迹。'}</p>
        </div>`;
    }
    if (activeFilter === 'all') {
        return `<div class="group-card-grid group-card-grid--all">
            ${items.map(item => item.kind === 'wish'
                ? wishCardHtml(item.data)
                : cardHtml(item.data)).join('')}
        </div>`;
    }
    if (activeFilter === 'wish') {
        return `<div class="group-card-grid group-card-grid--wish">
            ${wishItems.map(wishCardHtml).join('')}
        </div>`;
    }
    const section = (type, title, description) => {
        const sectionItems = items.filter(group => group.groupType === type);
        if (!sectionItems.length) return '';
        const id = type === 'trip' ? 'groupTripSectionTitle' : 'groupCollectionSectionTitle';
        const countText = type === 'trip'
            ? `${sectionItems.length} 段旅程`
            : `${sectionItems.length} 个收藏`;
        return `<section class="group-library-section group-library-section--${type}" aria-labelledby="${id}">
            <header class="group-library-section-head">
                <div>
                    <h3 id="${id}">${title}</h3>
                    <p>${description}</p>
                </div>
                <span>${countText}</span>
            </header>
            <div class="group-card-grid group-card-grid--${type}">
                ${sectionItems.map(cardHtml).join('')}
            </div>
        </section>`;
    };
    return activeFilter === 'trip'
        ? section('trip', '旅程', '按时间排好的完整路线')
        : section('collection', '收藏', '把同一主题的地点收在一起');
}

function bindGroupCards() {
    view.querySelectorAll('[data-group-key]').forEach(button => {
        button.addEventListener('click', () => openDetail(button.dataset.groupKey, true));
    });
    view.querySelectorAll('[data-wish-key]').forEach(button => {
        button.addEventListener('click', () => openWishDetail(button.dataset.wishKey, true));
    });
    view.querySelector('[data-clear-deep-link]')?.addEventListener('click', () => {
        deepLinkError = '';
        setUrl(false, true);
        renderList();
        view.querySelector('#footprintGroupsBack')?.focus({ preventScroll: true });
        announce('已显示全部旅途集');
    });
}

function renderListItems() {
    const list = view?.querySelector('.group-library-list');
    if (!list) return;
    list.innerHTML = listItemsHtml();
    bindGroupCards();
}

function syncWishStatusButtons() {
    view?.querySelectorAll('[data-wish-status-filter]').forEach(button => {
        button.setAttribute(
            'aria-pressed',
            String((button.dataset.wishStatusFilter || 'all') === wishStatusFilter)
        );
    });
}

function renderList(options = {}) {
    if (!view) return;
    view.classList.toggle('no-top-entry-animation', options.animateTop === false);
    const counts = filterCounts();
    view.innerHTML = `
        <header class="group-library-top">
            <button id="footprintGroupsBack" class="fp-btn" type="button" aria-label="返回地图">
                <span aria-hidden="true">←</span><span>返回地图</span>
            </button>
            <div class="group-library-title">
                <p>旅行组合</p>
                <h2>我的旅途集</h2>
                <span>${groups.length + wishes.length} 个记录</span>
            </div>
        </header>
        <div class="group-library-filterbar">
            <nav class="group-library-filters" aria-label="筛选旅途集">
                ${[
                    ['all', '全部'],
                    ['trip', '旅程'],
                    ['collection', '收藏'],
                    ['wish', '未来足迹']
                ].map(([key, label]) => `
                    <button type="button" data-group-filter="${key}"
                        aria-pressed="${activeFilter === key}">
                        <span>${label}</span><b>${counts[key]}</b>
                    </button>
                `).join('')}
            </nav>
            <div class="group-library-tools">
                ${activeFilter === 'wish' &&
                wishes.some(wish => wish.spec.status !== 'visited') ? `
                    <button type="button" class="group-wish-layer-toggle"
                        aria-pressed="${wishLayerVisible}">
                        地图显示
                    </button>` : ''}
                <label class="group-library-sort">
                    <span class="sr-only">排序旅途集</span>
                    <select aria-label="排序旅途集">
                        <option value="ordered"${listSort === 'ordered' ? ' selected' : ''}>推荐顺序</option>
                        <option value="recent"${listSort === 'recent' ? ' selected' : ''}>最近更新</option>
                        <option value="title"${listSort === 'title' ? ' selected' : ''}>名称</option>
                    </select>
                    <svg class="group-library-sort-chevron" viewBox="0 0 12 12"
                        aria-hidden="true">
                        <path d="m3 4.5 3 3 3-3"></path>
                    </svg>
                </label>
                <label class="group-library-search">
                    <span class="sr-only">搜索旅途集</span>
                    <input type="search" value="${escapeHtml(searchQuery)}"
                        placeholder="搜索标题、成员或地点" autocomplete="off">
                </label>
            </div>
        </div>
        ${activeFilter === 'wish' ? `
            <div class="group-wish-status-filters" role="group" aria-label="筛选未来足迹状态">
                ${[
                    ['all', '全部状态'],
                    ['wish', '心愿'],
                    ['planning', '计划中'],
                    ['booked', '已订票'],
                    ['visited', '已实现']
                ].map(([key, label]) => `
                    <button type="button" data-wish-status-filter="${key}"
                        aria-pressed="${wishStatusFilter === key}">${label}</button>
                `).join('')}
            </div>` : ''}
        <div class="group-library-list"></div>`;
    renderListItems();
    view.querySelector('#footprintGroupsBack')?.addEventListener('click', () => closeFootprintGroups());
    view.querySelectorAll('[data-group-filter]').forEach(button => {
        button.addEventListener('click', () => {
            const nextFilter = button.dataset.groupFilter || 'all';
            activeFilter = nextFilter;
            const list = view.querySelector('.group-library-list');
            if (list) listScrollTop = 0;
            renderList({ animateTop: false });
            const nextButton = view.querySelector(
                `[data-group-filter="${CSS.escape(nextFilter)}"]`
            );
            nextButton?.focus({ preventScroll: true });
            announce(`已切换到${button.querySelector('span')?.textContent || '全部'}，共 ${filteredGroups().length + (activeFilter === 'wish' ? wishes.length : 0)} 条`);
        });
    });
    const search = view.querySelector('.group-library-search input');
    search?.addEventListener('input', () => {
        searchQuery = search.value;
        renderListItems();
        const list = view.querySelector('.group-library-list');
        if (list) list.scrollTop = 0;
        announce(`筛选结果 ${filteredGroups().length} 条`);
    });
    const sort = view.querySelector('.group-library-sort select');
    sort?.addEventListener('change', () => {
        listSort = sort.value;
        renderListItems();
        const list = view.querySelector('.group-library-list');
        if (list) list.scrollTop = 0;
        announce(`已按${sort.options[sort.selectedIndex]?.text || '推荐顺序'}排序`);
    });
    const wishLayerToggle = view.querySelector('.group-wish-layer-toggle');
    wishLayerToggle?.addEventListener('click', () => {
        wishLayerVisible = !wishLayerVisible;
        wishLayerToggle.setAttribute('aria-pressed', String(wishLayerVisible));
        const count = deps.setWishLayerVisible?.(wishLayerVisible, wishes) || 0;
        announce(wishLayerVisible
            ? `已在地图中显示 ${count} 个未来足迹`
            : '已关闭未来足迹图层');
        if (wishLayerVisible) closeFootprintGroups(false);
        if (wishLayerVisible) requestAnimationFrame(applyWishLayerMapMode);
    });
    view.querySelectorAll('[data-wish-status-filter]').forEach(button => {
        button.addEventListener('click', () => {
            wishStatusFilter = button.dataset.wishStatusFilter || 'all';
            syncWishStatusButtons();
            renderListItems();
        });
    });
    if (options.restore) {
        requestAnimationFrame(() => {
            const list = view.querySelector('.group-library-list');
            if (list) list.scrollTop = listScrollTop;
            const target = listFocusKey
                ? view.querySelector(`[data-group-key="${CSS.escape(listFocusKey)}"]`)
                : view.querySelector(`[data-group-filter="${activeFilter}"]`);
            target?.focus({ preventScroll: true });
        });
    }
}

function memberCardHtml(member, index, segment) {
    const image = memberThumbnail(member);
    return `
        <li class="group-member-row">
            <button type="button" class="group-member-main" data-member-key="${escapeHtml(member.key)}"
                aria-label="查看第 ${index + 1} 站：${escapeHtml(member.name)}">
                <span class="group-member-photo">
                    <span class="group-member-index" aria-hidden="true">${index + 1}</span>
                    ${image
                        ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">`
                        : `<span aria-hidden="true">${escapeHtml((member.city || member.name).slice(0, 1))}</span>`}
                </span>
                <span class="group-member-copy">
                    <strong>${escapeHtml(member.name)}</strong>
                    <span>${escapeHtml([member.city, member.province].filter(Boolean).join(' / ') || '未解析地区')}</span>
                    <time datetime="${escapeHtml(member.createTime)}">${escapeHtml(formatDate(member.createTime))}</time>
                </span>
            </button>
            ${segment ? `<span class="group-member-distance is-${segment.km == null ? 'missing' : 'ready'}">
                ${escapeHtml(groupDistanceText(segment))}
            </span>` : ''}
        </li>`;
}

function collectionMemberHtml(member, index) {
    const image = memberThumbnail(member);
    return `
        <button type="button" class="group-collection-item" data-member-key="${escapeHtml(member.key)}"
            aria-label="查看第 ${index + 1} 个收藏：${escapeHtml(member.name)}">
            <span class="group-collection-photo">
                ${image
                    ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">`
                    : `<span aria-hidden="true">${escapeHtml((member.city || member.name).slice(0, 1))}</span>`}
            </span>
            <span class="group-collection-item-copy">
                <b>${escapeHtml(member.name)}</b>
                <small>${escapeHtml([member.city, member.province].filter(Boolean).join(' / ') || '未解析地区')}</small>
                <time datetime="${escapeHtml(member.createTime)}">${escapeHtml(formatDate(member.createTime, true))}</time>
            </span>
            <i aria-hidden="true">${index + 1}</i>
        </button>`;
}

function memberBatchHtml(group, start, end) {
    return group.members.slice(start, end).map((member, offset) => {
        const index = start + offset;
        return group.groupType === 'trip'
            ? memberCardHtml(member, index, index ? group.segments[index - 1] : null)
            : collectionMemberHtml(member, index);
    }).join('');
}

function memberMoreHtml(group) {
    const remaining = Math.max(0, group.members.length - visibleMemberCount);
    if (!remaining) return '';
    return `<button id="groupLoadMore" class="fp-btn group-load-more" type="button">
        继续加载剩余 ${remaining} 条
    </button>`;
}

function updateMapDock() {
    if (!mapDock || !activeGroup) return;
    if (returnButton) returnButton.textContent = '返回旅程';
    const member = activeGroup.members[mapMemberIndex] || activeGroup.members[0];
    const total = activeGroup.members.length;
    const activeMember = mapMemberActivated ? member : null;
    if (mapDockType) mapDockType.textContent = typeText(activeGroup);
    if (mapDockTitle) mapDockTitle.textContent = activeGroup.title;
    if (mapDockStation) {
        mapDockStation.textContent = activeGroup.groupType === 'trip' && activeMember
            ? activeMember.name
            : '收录进度';
        if (activeGroup.groupType === 'trip' && !activeMember) {
            mapDockStation.textContent = '尚未开始';
        }
    }
    if (mapDockProgress) {
        mapDockProgress.textContent = activeGroup.groupType === 'trip' && activeMember
            ? `第 ${mapMemberIndex + 1} 站 / 共 ${total} 站`
            : (activeGroup.groupType === 'trip'
                ? `共 ${total} 站，等待开始`
                : progressText(activeGroup));
    }
    if (mapDockMeta) {
        const dateText = cardRangeText(activeGroup);
        const placeText = activeMember
            ? [activeMember.city, activeMember.province].filter(Boolean).join(' / ')
            : '';
        const distanceText = activeGroup.groupType === 'trip'
            ? `直线约 ${Math.round(activeGroup.distanceKm).toLocaleString('zh-CN')} 公里`
            : `${activeGroup.cityCount} 座城市，${activeGroup.provinceCount} 个省份`;
        mapDockMeta.textContent = [dateText, placeText, distanceText].filter(Boolean).join('，');
    }
    if (mapDockMeter) {
        const current = activeGroup.groupType === 'trip'
            ? (mapMemberActivated ? mapMemberIndex + 1 : 0)
            : activeGroup.members.length;
        const maximum = activeGroup.groupType === 'trip'
            ? total
            : Math.max(activeGroup.targetCount || total, total);
        const progress = maximum > 0 ? Math.min(100, Math.round(current / maximum * 100)) : 0;
        mapDockMeter.style.setProperty('--group-map-progress', `${progress}%`);
        mapDockMeter.setAttribute('aria-valuemax', String(maximum));
        mapDockMeter.setAttribute('aria-valuenow', String(current));
        mapDockMeter.setAttribute(
            'aria-valuetext',
            activeGroup.groupType === 'trip'
                ? (mapMemberActivated
                    ? `第 ${current} 站，共 ${maximum} 站`
                    : `尚未开始，共 ${maximum} 站`)
                : `已收录 ${current} 条，目标 ${maximum} 条`
        );
    }
    if (mapDockPrev) mapDockPrev.hidden = activeGroup.groupType !== 'trip';
    if (mapDockNext) mapDockNext.hidden = activeGroup.groupType !== 'trip';
    if (mapDockNext) {
        mapDockNext.textContent = !mapMemberActivated ? '开始第 1 站' : '下一站';
    }
    if (mapDockPrev) {
        mapDockPrev.disabled = !mapMemberActivated || mapMemberIndex <= 0;
    }
    if (mapDockNext) {
        mapDockNext.disabled = total === 0 ||
            (mapMemberActivated && mapMemberIndex >= total - 1);
    }
}

function syncWishSceneModeControl() {
    if (!mapSceneModeButton) return;
    const visible = wishLayerMapMode || !!(activeWish && activeFromMap);
    mapSceneModeButton.hidden = !visible;
    const to3D = !!deps.isAmapMode?.();
    mapSceneModeButton.textContent = to3D ? '3D 地球' : '2D 地图';
    mapSceneModeButton.title = to3D ? '切换到 3D 地球' : '切换到 2D 平面地图';
}

function focusMapMember(index) {
    if (!activeGroup || index < 0 || index >= activeGroup.members.length) return;
    const group = activeGroup;
    mapMemberIndex = index;
    mapMemberActivated = true;
    updateMapDock();
    deps.activateGroupMember?.(activeGroup, index);
    clearTimeout(mapFocusTimer);
    mapFocusTimer = setTimeout(() => {
        deps.focusGroupMember?.(group, index);
    }, 260);
    announce(`正在地图查看第 ${index + 1} 站，${activeGroup.members[index].name}`);
}

function stepMapMember(delta) {
    if (!activeGroup || activeGroup.groupType !== 'trip') return;
    const next = mapMemberActivated
        ? mapMemberIndex + delta
        : (delta > 0 ? mapMemberIndex : -1);
    if (next < 0 || next >= activeGroup.members.length) return;
    focusMapMember(next);
}

function trackMapMember(key) {
    if (!activeGroup || !activeFromMap) return false;
    const index = activeGroup.members.findIndex(member => member.key === key);
    if (index < 0) return false;
    mapMemberIndex = index;
    mapMemberActivated = true;
    updateMapDock();
    announce(`第 ${index + 1} 站，共 ${activeGroup.members.length} 站`);
    return true;
}

function openMemberFromDetail(member) {
    if (!member || !activeGroup) return;
    const group = activeGroup;
    detailScrollTop = view.querySelector('.group-detail')?.scrollTop || detailScrollTop;
    detailFocusKey = member.key;
    closeOverlay(false);
    deps.openMember(member, {
        backLabel: group.groupType === 'trip' ? '返回旅程' : '返回收藏',
        onClose: () => {
            activeGroup = group;
            activeFromMap = false;
            showOverlay();
            renderDetail();
            announce(`已返回${typeText(group)}：${group.title}`);
        }
    });
}

function openWishRealizedMember(member) {
    if (!member || !activeWish) return;
    const wish = activeWish;
    detailScrollTop = view.querySelector('.group-detail')?.scrollTop || detailScrollTop;
    closeOverlay(false);
    deps.openMember(member, {
        backLabel: '返回未来足迹',
        onClose: () => {
            activeWish = wish;
            activeGroup = null;
            activeFromMap = false;
            showOverlay();
            renderWishDetail();
            announce(`已返回未来足迹：${wish.spec.title}`);
        }
    });
}

function detailStatsHtml(group) {
    return `
        <dl class="group-detail-stats">
            <div><dt>${group.groupType === 'trip' ? '日期' : '完成度'}</dt>
                <dd>${escapeHtml(group.groupType === 'trip' ? rangeText(group) : progressText(group))}</dd></div>
            <div><dt>${group.groupType === 'trip' ? '站点' : '收录'}</dt>
                <dd>${group.members.length} 条足迹</dd></div>
            <div><dt>覆盖</dt><dd>${group.cityCount} 座城市，${group.provinceCount} 个省份</dd></div>
            <div><dt>${group.groupType === 'trip' ? '直线距离' : '照片'}</dt>
                <dd>${group.groupType === 'trip'
                    ? `${Math.round(group.distanceKm).toLocaleString('zh-CN')} 公里`
                    : `${group.photoCount} 张`}</dd></div>
        </dl>`;
}

function detailWarningsHtml(group) {
    return [
        group.missingCount
            ? `<p class="group-detail-warning">${group.missingCount} 个成员足迹已失效，统计中已跳过。</p>`
            : '',
        group.unlocatableCount
            ? `<p class="group-detail-warning">${group.unlocatableCount} 个成员缺少有效坐标，地图和距离统计中已跳过。</p>`
            : ''
    ].join('');
}

function tripDetailHeroHtml(group) {
    const routeMembers = group.members.slice(0, 7);
    const routePreview = routeMembers.map((member, index) => `
        <li class="${index === 0 ? 'is-start' : ''}${index === routeMembers.length - 1 ? ' is-end' : ''}">
            <i aria-hidden="true"></i>
            <span>${escapeHtml(member.name)}</span>
        </li>`).join('');
    return `
        <section class="group-detail-panel group-detail-panel--trip" aria-labelledby="groupDetailTitle">
            <div class="group-trip-detail-visual">
                <div class="group-detail-cover group-trip-detail-cover">
                    ${group.cover
                        ? `<img src="${escapeHtml(group.cover)}" alt="" loading="lazy" style="--group-cover-focus: ${escapeHtml(group.coverFocus)}">`
                        : `<span aria-hidden="true">${escapeHtml(groupInitial(group, group.members[0]))}</span>`}
                </div>
            </div>
            <div class="group-detail-heading group-trip-detail-copy">
                <div class="group-detail-kicker">
                    <span>旅程路线</span>
                    ${group.visibility === 'private' ? '<b>私密</b>' : ''}
                </div>
                <h2 id="groupDetailTitle">${escapeHtml(group.title)}</h2>
                <p class="group-detail-description">${escapeHtml(group.description || '这段旅行还没有补上说明。')}</p>
                <div class="group-trip-detail-route">
                    <ol>${routePreview}</ol>
                    ${group.members.length > routeMembers.length
                        ? `<span>还有 ${group.members.length - routeMembers.length} 站</span>`
                        : ''}
                </div>
                ${groupChipsHtml(group)}
                ${detailStatsHtml(group)}
                ${detailWarningsHtml(group)}
            </div>
        </section>`;
}

function collectionDetailHeroHtml(group) {
    const urls = groupMemberPreviewImageUrls(group, 4).map(url => deps.cityCardImageUrl(url));
    const tiles = urls.length
        ? urls.map((url, index) => `
            <span class="group-collection-detail-tile${index === 0 ? ' is-hero' : ''}">
                <img src="${escapeHtml(url)}" alt="" loading="lazy">
            </span>`).join('')
        : `<span class="group-collection-detail-tile is-hero">
            <span aria-hidden="true">${escapeHtml(groupInitial(group, group.members[0]))}</span>
        </span>`;
    const target = Math.max(group.targetCount || group.members.length, group.members.length, 1);
    const progress = Math.min(100, Math.round(group.members.length / target * 100));
    const tileCount = urls.length || 1;
    return `
        <section class="group-detail-panel group-detail-panel--collection" aria-labelledby="groupDetailTitle">
            <div class="group-collection-detail-mosaic tile-count-${tileCount}" aria-hidden="true">${tiles}</div>
            <div class="group-detail-heading group-collection-detail-copy">
                <div class="group-detail-kicker">
                    <span>主题收藏</span>
                    ${group.visibility === 'private' ? '<b>私密</b>' : ''}
                </div>
                <h2 id="groupDetailTitle">${escapeHtml(group.title)}</h2>
                <p class="group-detail-description">${escapeHtml(group.description || '把同一主题的足迹收在一起，慢慢翻看。')}</p>
                ${groupChipsHtml(group)}
                <div class="group-collection-detail-progress"
                    role="progressbar" aria-label="收藏完成度"
                    aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${group.members.length}">
                    <span><b>${escapeHtml(progressText(group))}</b><i>${progress}%</i></span>
                    <em style="--group-collection-progress: ${progress}%"></em>
                </div>
                ${detailStatsHtml(group)}
                ${detailWarningsHtml(group)}
            </div>
        </section>`;
}

function renderDetail() {
    if (!view || !activeGroup) return;
    const group = activeGroup;
    visibleMemberCount = Math.min(
        Math.max(visibleMemberCount, MEMBER_PAGE_SIZE),
        group.members.length
    );
    const article = safeLink(group.article);
    const isTrip = group.groupType === 'trip';
    const allMembersMissing = group.names.length > 0 && group.members.length === 0;
    const body = group.members.length
        ? `<${isTrip ? 'ol' : 'div'}
                id="groupMemberList"
                class="${isTrip ? 'group-trip-list' : 'group-collection-grid'}">
                ${memberBatchHtml(group, 0, visibleMemberCount)}
            </${isTrip ? 'ol' : 'div'}>
            ${memberMoreHtml(group)}`
        : `<div class="group-library-empty">
            <h3>${allMembersMissing
                ? '成员足迹已全部失效'
                : (isTrip ? '这段旅程还没有站点' : '这个收藏还没有内容')}</h3>
            <p>${allMembersMissing
                ? `请在后台编辑这个${typeText(group)}，移除失效引用或补充新的足迹。`
                : (isTrip
                    ? '在后台编辑旅程，从已有足迹中安排第一站。'
                    : '在后台编辑收藏，从已有足迹中挑选地点。')}</p>
        </div>`;

    view.innerHTML = `
        <header class="group-library-top">
            <button id="footprintGroupsBack" class="fp-btn" type="button" aria-label="返回旅途集列表">
                <span aria-hidden="true">←</span><span>${relatedWishReturn
                    ? '返回未来足迹'
                    : (activeFromMap ? '返回地图' : '全部旅途集')}</span>
            </button>
            <div id="groupDetailCompactTitle" class="group-detail-compact-title" hidden>
                <span>${escapeHtml(typeText(group))}</span>
                <strong>${escapeHtml(group.title)}</strong>
            </div>
            <div class="group-library-actions">
                ${activeFromMap
                    ? '<button id="footprintGroupsAll" class="fp-btn" type="button">全部旅途集</button>'
                    : ''}
                <button id="groupCopyLink" class="fp-btn" type="button">${copied ? '已复制' : '复制链接'}</button>
                ${article ? `<a class="fp-btn" href="${escapeHtml(article)}" target="_blank" rel="noopener noreferrer">阅读游记</a>` : ''}
                ${group.members.length
                    ? `<button id="groupViewMap" class="fp-btn group-map-action" type="button">
                        在地图中查看
                    </button>`
                    : ''}
            </div>
        </header>
        <article class="group-detail ${isTrip ? 'is-trip-detail' : 'is-collection-detail'}" tabindex="-1">
            ${isTrip ? tripDetailHeroHtml(group) : collectionDetailHeroHtml(group)}
            <section class="group-detail-body" aria-label="${escapeHtml(isTrip ? '旅程站点' : '收藏内容')}">
                ${body}
            </section>
        </article>`;

    view.querySelector('#footprintGroupsBack')?.addEventListener('click', () => {
        if (relatedWishReturn) {
            const wish = relatedWishReturn;
            relatedWishReturn = null;
            activeGroup = null;
            activeWish = wish;
            setUrl(true);
            renderWishDetail();
            return;
        }
        if (activeFromMap && activeGroup) applyMapView(activeGroup);
        else returnToList();
    });
    view.querySelector('#groupViewMap')?.addEventListener('click', viewOnMap);
    view.querySelector('#footprintGroupsAll')?.addEventListener('click', returnToList);
    view.querySelector('#groupCopyLink')?.addEventListener('click', async () => {
        try {
            await copyText(window.location.href);
            copied = true;
            const button = view.querySelector('#groupCopyLink');
            if (button) button.textContent = '已复制';
            announce('记录链接已复制');
        } catch {
            copied = false;
            announce('复制链接失败，请从地址栏复制');
        }
    });
    const loadMore = (moveFocus = false) => {
        if (!activeGroup || visibleMemberCount >= activeGroup.members.length) return;
        const start = visibleMemberCount;
        visibleMemberCount = Math.min(activeGroup.members.length, start + MEMBER_PAGE_SIZE);
        const memberList = view.querySelector('#groupMemberList');
        if (memberList) {
            memberList.insertAdjacentHTML('beforeend', memberBatchHtml(activeGroup, start, visibleMemberCount));
        }
        const more = view.querySelector('#groupLoadMore');
        if (more) {
            const remaining = activeGroup.members.length - visibleMemberCount;
            if (remaining > 0) more.textContent = `继续加载剩余 ${remaining} 条`;
            else more.remove();
        }
        announce(`已显示 ${visibleMemberCount} / ${activeGroup.members.length} 个成员`);
        if (moveFocus) {
            requestAnimationFrame(() => {
                const buttons = memberList?.querySelectorAll('[data-member-key]');
                buttons?.[start]?.focus({ preventScroll: true });
            });
        }
    };
    view.querySelector('#groupLoadMore')?.addEventListener('click', () => loadMore(true));
    const detail = view.querySelector('.group-detail');
    const updateCompactTitle = () => {
        const compact = view.querySelector('#groupDetailCompactTitle');
        if (compact) compact.hidden = detail.scrollTop < 100;
    };
    detail?.addEventListener('scroll', () => {
        detailScrollTop = detail.scrollTop;
        updateCompactTitle();
        if (detail.scrollHeight - detail.scrollTop - detail.clientHeight < 220) loadMore(false);
    });
    requestAnimationFrame(() => {
        if (detail) {
            detail.scrollTop = detailScrollTop;
            updateCompactTitle();
        }
        const focusTarget = detailFocusKey
            ? view.querySelector(`[data-member-key="${CSS.escape(detailFocusKey)}"]`)
            : null;
        detailFocusKey = '';
        (focusTarget || view.querySelector('#footprintGroupsBack'))
            ?.focus({ preventScroll: true });
    });
}

function renderWishDetail() {
    if (!view || !activeWish) return;
    const wish = activeWish;
    const article = safeLink(wish.spec.article);
    const realizedFootprint = deps.footprints().find(
        item => item.key === wish.spec.realizedFootprintName
    );
    const realizedGroup = groups.find(
        item => item.key === wish.spec.realizedGroupName
    );
    const tags = Array.isArray(wish.spec.tags) ? wish.spec.tags : [];
    view.innerHTML = `
        <header class="group-library-top group-wish-detail-top">
            <button id="footprintGroupsBack" class="fp-btn" type="button" aria-label="返回未来足迹列表">
                <span aria-hidden="true">←</span><span>${activeFromMap ? '返回地图' : '全部旅途集'}</span>
            </button>
            <div class="group-wish-detail-actions">
                ${activeFromMap
                    ? '<button id="wishAllGroups" class="fp-btn" type="button">全部旅途集</button>'
                    : ''}
                <button id="wishCopyLink" class="fp-btn" type="button">复制链接</button>
                ${article
                    ? `<a class="fp-btn" href="${escapeHtml(article)}" target="_blank" rel="noopener noreferrer">参考资料</a>`
                    : ''}
                <button id="wishViewMap" class="fp-btn" type="button">在地图中查看</button>
            </div>
        </header>
        <article class="group-detail is-wish-detail" tabindex="-1">
            <section class="group-wish-detail-panel">
                <div class="group-wish-detail-kicker">
                    <span>未来足迹</span>
                    <b>${escapeHtml(wishStatusText(wish))}</b>
                </div>
                <h1>${escapeHtml(wish.spec.title)}</h1>
                <p class="group-wish-detail-region">${escapeHtml(wishRegionText(wish))}</p>
                <dl class="group-wish-detail-meta">
                    <div><dt>计划时间</dt><dd>${escapeHtml(wishPlanText(wish))}</dd></div>
                    <div><dt>坐标</dt><dd>${escapeHtml(wishCoordinateText(wish))}</dd></div>
                    <div><dt>地址</dt><dd>${escapeHtml(wish.spec.address || '未补充详细地址')}</dd></div>
                </dl>
                ${tags.length
                    ? `<div class="group-library-types">${tags
                        .map(tag => `<span class="group-chip">${escapeHtml(tag)}</span>`)
                        .join('')}</div>`
                    : ''}
                <section class="group-wish-story">
                    <h2>为什么想去</h2>
                    <p>${escapeHtml(wish.spec.description || '还没有写下想去这里的理由。')}</p>
                </section>
                ${wish.spec.status === 'visited'
                    ? `<section class="group-wish-realized">
                        <h2>已实现</h2>
                        <p>${realizedFootprint || realizedGroup
                            ? '这条心愿已经关联到真实旅行记录。'
                            : '这条心愿已标记为实现，但还没有关联足迹或旅程。'}</p>
                        <div>
                            ${realizedFootprint
                                ? `<button id="wishOpenFootprint" class="fp-btn" type="button">打开关联足迹</button>`
                                : ''}
                            ${realizedGroup
                                ? `<button id="wishOpenGroup" class="fp-btn" type="button">打开关联旅程</button>`
                                : ''}
                        </div>
                    </section>`
                    : ''}
            </section>
        </article>`;

    view.querySelector('#footprintGroupsBack')?.addEventListener('click', () => {
        if (activeFromMap && activeWish) applyWishMapView(activeWish);
        else returnToList();
    });
    view.querySelector('#wishViewMap')?.addEventListener('click', () => {
        if (activeWish) applyWishMapView(activeWish);
    });
    view.querySelector('#wishAllGroups')?.addEventListener('click', returnToList);
    view.querySelector('#wishCopyLink')?.addEventListener('click', async () => {
        try {
            await copyText(window.location.href);
            const node = view.querySelector('#wishCopyLink');
            if (node) node.textContent = '已复制';
            announce('未来足迹链接已复制');
        } catch {
            announce('复制链接失败，请从地址栏复制');
        }
    });
    view.querySelector('#wishOpenFootprint')?.addEventListener('click', () => {
        if (realizedFootprint) openWishRealizedMember(realizedFootprint);
    });
    view.querySelector('#wishOpenGroup')?.addEventListener('click', () => {
        if (realizedGroup && activeWish) {
            openDetail(realizedGroup.key, false, false, false, activeWish);
        }
    });
    requestAnimationFrame(() => {
        const detail = view.querySelector('.group-detail');
        if (detail) detail.scrollTop = detailScrollTop;
        view.querySelector('#footprintGroupsBack')?.focus({ preventScroll: true });
    });
}

function setUrl(detail, replace = false) {
    if (!window.location.pathname.endsWith('/footprints')) return;
    const params = new URLSearchParams();
    params.set('view', 'groups');
    if (detail && activeGroup) params.set('group', activeGroup.key);
    if (detail && activeWish) params.set('wish', activeWish.metadata.name);
    const method = replace ? 'replaceState' : 'pushState';
    history[method]({ footprintGroups: true }, '', window.location.pathname + '?' + params.toString());
}

function applyMapView(group) {
    activeWish = null;
    activeGroup = group;
    activeFromMap = true;
    closeOverlay(false);
    deps.pauseAutoRotate('group-map');
    document.body.classList.add('footprint-group-map-mode');
    globeButton?.setAttribute('aria-pressed', 'true');
    mapButton?.setAttribute('aria-pressed', 'true');
    mapMemberIndex = 0;
    mapMemberActivated = false;
    updateMapDock();
    syncWishSceneModeControl();
    if (mapDock) mapDock.hidden = false;
    // 先让信息坞进入布局，2D setFitView 才能量到真实高度并为底部留白。
    deps.applyGroupOnMap(group);
    announce(`正在查看${group.title}的${typeText(group)}地图`);
}

function applyWishMapView(wish) {
    activeGroup = null;
    activeWish = wish;
    activeFromMap = true;
    closeOverlay(false);
    deps.pauseAutoRotate('wish-map');
    document.body.classList.add('footprint-group-map-mode');
    globeButton?.setAttribute('aria-pressed', 'true');
    mapButton?.setAttribute('aria-pressed', 'true');
    if (mapDockType) mapDockType.textContent = '未来足迹';
    if (mapDockTitle) mapDockTitle.textContent = wish.spec.title;
    if (mapDockStation) mapDockStation.textContent = wishStatusText(wish);
    if (mapDockProgress) mapDockProgress.textContent = wishPlanText(wish);
    if (mapDockMeta) {
        mapDockMeta.textContent = [...new Set(
            [wishRegionText(wish), wish.spec.address].filter(Boolean)
        )].join('，');
    }
    if (mapDockMeter) mapDockMeter.hidden = true;
    if (mapDockPrev) mapDockPrev.hidden = true;
    if (mapDockNext) mapDockNext.hidden = true;
    if (mapDockExit) mapDockExit.textContent = '退出查看';
    if (returnButton) returnButton.textContent = '返回未来足迹';
    if (mapDock) mapDock.hidden = false;
    syncWishSceneModeControl();
    deps.showWishOnMap?.(wish);
    announce(`正在地图中查看未来足迹：${wish.spec.title}`);
}

function applyWishLayerMapMode() {
    if (!wishLayerVisible || !wishes.some(wish => wish.spec.status !== 'visited')) return;
    wishLayerMapMode = true;
    activeGroup = null;
    activeWish = null;
    activeFromMap = false;
    deps.pauseAutoRotate('wish-layer-map');
    document.body.classList.add('footprint-group-map-mode');
    globeButton?.setAttribute('aria-pressed', 'true');
    mapButton?.setAttribute('aria-pressed', 'true');
    const visible = wishes.filter(wish => wish.spec.status !== 'visited');
    if (mapDockType) mapDockType.textContent = '未来足迹';
    if (mapDockTitle) mapDockTitle.textContent = '未来足迹';
    if (mapDockStation) mapDockStation.textContent = `共 ${visible.length} 个地点`;
    if (mapDockProgress) mapDockProgress.textContent = '只显示未实现的心愿地点';
    if (mapDockMeta) {
        mapDockMeta.textContent = '心愿、计划中与已订票地点，不包含已实现地点';
    }
    if (mapDockMeter) mapDockMeter.hidden = true;
    if (mapDockPrev) mapDockPrev.hidden = true;
    if (mapDockNext) mapDockNext.hidden = true;
    if (mapDockExit) mapDockExit.textContent = '退出地图显示';
    if (returnButton) returnButton.textContent = '返回未来足迹';
    if (mapDock) mapDock.hidden = false;
    syncWishSceneModeControl();
    deps.setWishLayerVisible?.(true, wishes);
    announce(`已进入未来足迹地图显示，共 ${visible.length} 个地点`);
}

function exitWishLayerMap() {
    wishLayerMapMode = false;
    wishLayerVisible = false;
    deps.setWishLayerVisible?.(false, wishes);
    deps.resumeAutoRotate('wish-layer-map');
    document.body.classList.remove('footprint-group-map-mode');
    if (mapDock) mapDock.hidden = true;
    syncWishSceneModeControl();
    globeButton?.setAttribute('aria-pressed', 'false');
    mapButton?.setAttribute('aria-pressed', 'false');
    if (mapDockMeter) mapDockMeter.hidden = false;
    announce('已退出未来足迹地图显示');
}

function viewOnMap() {
    if (activeWish) {
        detailScrollTop = view.querySelector('.group-detail')?.scrollTop || detailScrollTop;
        applyWishMapView(activeWish);
        return;
    }
    if (!activeGroup) return;
    detailScrollTop = view.querySelector('.group-detail')?.scrollTop || detailScrollTop;
    applyMapView(activeGroup);
}

function returnToList() {
    activeGroup = null;
    activeWish = null;
    relatedWishReturn = null;
    activeFromMap = false;
    detailScrollTop = 0;
    syncWishSceneModeControl();
    setUrl(false, true);
    renderList({ restore: true });
    announce('已返回旅途集列表');
}

function clearMapGroup() {
    clearTimeout(mapFocusTimer);
    deps.resumeAutoRotate('group-map');
    deps.clearGroupOnMap();
    activeFromMap = false;
    mapMemberActivated = false;
    document.body.classList.remove('footprint-group-map-mode');
    if (mapDock) mapDock.hidden = true;
    syncWishSceneModeControl();
    globeButton?.setAttribute('aria-pressed', 'false');
    mapButton?.setAttribute('aria-pressed', 'false');
    if (!view.classList.contains('show')) activeGroup = null;
}

function clearWishMap() {
    wishLayerMapMode = false;
    deps.clearWishOnMap?.();
    deps.resumeAutoRotate('wish-map');
    activeFromMap = false;
    document.body.classList.remove('footprint-group-map-mode');
    if (mapDock) mapDock.hidden = true;
    syncWishSceneModeControl();
    globeButton?.setAttribute('aria-pressed', 'false');
    mapButton?.setAttribute('aria-pressed', 'false');
    if (mapDockMeter) mapDockMeter.hidden = false;
    if (wishLayerVisible) deps.setWishLayerVisible?.(true, wishes);
}

function exitGroupMap() {
    if (!activeGroup || !activeFromMap) return;
    clearMapGroup();
    deps.resetGroupMapView?.();
    activeGroup = null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'groups' && window.location.pathname.endsWith('/footprints')) {
        history.replaceState({}, '', window.location.pathname);
    }
    announce('已退出旅程地图查看');
}

function exitWishMap() {
    if (!activeWish || !activeFromMap) return;
    clearWishMap();
    activeWish = null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'groups' && window.location.pathname.endsWith('/footprints')) {
        history.replaceState({}, '', window.location.pathname);
    }
    announce('已退出未来足迹地图查看');
}

function showOverlay() {
    if (!view) return;
    document.body.classList.remove('footprint-group-map-mode');
    if (deps.cityWall().classList.contains('show')) deps.closeCityWall();
    deps.hideMarkerCard();
    deps.hideCityCard(false);
    deps.hideMarkerTip();
    deps.pauseAutoRotate('groups');
    deps.setGlobeRenderLoop(false);
    deps.setOverlayHidden(view, false);
    view.classList.add('show');
    view.setAttribute('aria-hidden', 'false');
    view.inert = false;
    document.body.classList.add('footprint-groups-open');
    if (mapDock) mapDock.hidden = true;
    setBackgroundInert(true);
}

function closeOverlay(restoreFocus = true) {
    if (!view) return;
    document.body.classList.remove('footprint-group-map-mode');
    view.classList.remove('show');
    view.setAttribute('aria-hidden', 'true');
    view.innerHTML = '';
    document.body.classList.remove('footprint-groups-open');
    deps.setOverlayHidden(view, true);
    deps.setGlobeRenderLoop(true);
    deps.resumeAutoRotate('groups');
    globeButton?.setAttribute('aria-pressed', 'false');
    mapButton?.setAttribute('aria-pressed', 'false');
    view.inert = false;
    setBackgroundInert(false);
    if (restoreFocus && triggerElement && triggerElement.isConnected) triggerElement.focus();
}

export function openFootprintGroups(trigger, options = {}) {
    if (!view) return;
    triggerElement = trigger || document.activeElement;
    deps.clearGroupOnMap();
    refreshResolvedGroups();
    activeFromMap = false;
    activeGroup = null;
    activeWish = null;
    copied = false;
    deepLinkError = '';
    showOverlay();
    if (options.wishKey) {
        const wish = wishes.find(item => item.metadata.name === options.wishKey);
        if (wish) {
            openWishDetail(wish.metadata.name, false, false, false);
        } else {
            deepLinkError = 'unavailable';
            renderList();
            announce('记录不存在或尚未公开');
        }
    } else if (options.groupKey) {
        const group = groups.find(item => item.key === options.groupKey);
        if (group) {
            openDetail(group.key, false, false, false);
        } else {
            deepLinkError = 'unavailable';
            renderList();
            announce('记录不存在或尚未公开');
        }
    } else {
        activeGroup = null;
        if (options.syncUrl !== false) setUrl(false);
        renderList();
    }
    requestAnimationFrame(() => view.querySelector('button, a')?.focus({ preventScroll: true }));
}

function openDetail(
    key,
    updateUrl = true,
    fromRoute = false,
    restoreDetail = false,
    returnWish = null
) {
    const group = groups.find(item => item.key === key);
    if (!group) {
        deepLinkError = 'unavailable';
        activeGroup = null;
        renderList();
        announce('记录不存在或尚未公开');
        return;
    }
    if (!fromRoute) {
        const list = view.querySelector('.group-library-list');
        if (list) listScrollTop = list.scrollTop;
        listFocusKey = document.activeElement?.closest?.('[data-group-key]')?.dataset?.groupKey || '';
        if (!restoreDetail) {
            detailScrollTop = 0;
            visibleMemberCount = MEMBER_PAGE_SIZE;
        }
    }
    activeGroup = group;
    activeWish = null;
    relatedWishReturn = returnWish;
    activeFromMap = fromRoute;
    copied = false;
    deepLinkError = '';
    if (updateUrl) setUrl(true);
    if (mapDock) mapDock.hidden = true;
    renderDetail();
    announce(`已打开${typeText(group)}：${group.title}`);
}

function openWishDetail(key, updateUrl = true, fromRoute = false, restoreDetail = false) {
    const wish = wishes.find(item => item.metadata.name === key);
    if (!wish) {
        deepLinkError = 'unavailable';
        activeWish = null;
        renderList();
        announce('记录不存在或尚未公开');
        return;
    }
    if (!restoreDetail) {
        const list = view.querySelector('.group-library-list');
        if (list) listScrollTop = list.scrollTop;
        listFocusKey = document.activeElement?.closest?.('[data-wish-key]')?.dataset?.wishKey || '';
        detailScrollTop = 0;
    }
    activeGroup = null;
    activeWish = wish;
    relatedWishReturn = null;
    activeFromMap = fromRoute;
    copied = false;
    deepLinkError = '';
    if (updateUrl) setUrl(true);
    if (mapDock) mapDock.hidden = true;
    renderWishDetail();
    announce(`已打开未来足迹：${wish.spec.title}`);
}

export function closeFootprintGroups(restoreFocus = true) {
    if ((!view || !view.classList.contains('show')) && !activeFromMap) return false;
    clearMapGroup();
    clearWishMap();
    activeGroup = null;
    activeWish = null;
    relatedWishReturn = null;
    activeFromMap = false;
    if (view?.classList.contains('show')) closeOverlay(restoreFocus);
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'groups' && window.location.pathname.endsWith('/footprints')) {
        history.replaceState({}, '', window.location.pathname);
    }
    return true;
}

export function backFootprintGroups() {
    if (!view || !view.classList.contains('show')) return false;
    if (activeWish) {
        if (activeFromMap) applyWishMapView(activeWish);
        else returnToList();
        return true;
    }
    if (activeGroup) {
        if (activeFromMap) applyMapView(activeGroup);
        else returnToList();
        return true;
    }
    return closeFootprintGroups();
}

export function setupFootprintGroups(d) {
    deps = d;
    if (returnButton) {
        returnButton.addEventListener('click', () => {
            if (wishLayerMapMode) {
                exitWishLayerMap();
                activeFilter = 'wish';
                showOverlay();
                renderList();
                return;
            }
            if (activeWish) {
                deps.clearWishOnMap?.();
                showOverlay();
                openWishDetail(activeWish.metadata.name, false, true, true);
                return;
            }
            if (!activeGroup) return;
            deps.clearGroupOnMap();
            showOverlay();
            openDetail(activeGroup.key, false, true, true);
        });
    }
    mapDockPrev?.addEventListener('click', () => stepMapMember(-1));
    mapDockNext?.addEventListener('click', () => stepMapMember(1));
    mapSceneModeButton?.addEventListener('click', () => deps.toggleViewMode?.());
    mapDockExit?.addEventListener('click', () => {
        if (wishLayerMapMode) exitWishLayerMap();
        else if (activeWish) exitWishMap();
        else exitGroupMap();
    });
    if (view) {
        view.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target !== view) return;
            backgroundPointerStart = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY
            };
        });
        view.addEventListener('pointerup', event => {
            const start = backgroundPointerStart;
            backgroundPointerStart = null;
            if (!start || start.pointerId !== event.pointerId || event.target !== view) return;
            const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
            if (moved > BACKGROUND_CLICK_SLOP || hasTextSelection()) return;
            closeFootprintGroups();
        });
        view.addEventListener('pointercancel', () => {
            backgroundPointerStart = null;
        });
        view.addEventListener('click', event => {
            const memberButton = event.target.closest?.('[data-member-key]');
            if (!memberButton || !activeGroup) return;
            const index = activeGroup.members.findIndex(
                member => member.key === memberButton.dataset.memberKey
            );
            if (index >= 0) openMemberFromDetail(activeGroup.members[index]);
        });
    }
    document.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const root = view && view.classList.contains('show') ? view : null;
        if (!root) return;
        const focusables = focusableElements(root);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
    document.addEventListener('footprint:group-member-click', event => {
        trackMapMember(event.detail?.key);
    });
    window.FootprintGroupBridge = {
        trackMapMember(fp) {
            return trackMapMember(fp?.key);
        }
    };
}

export function initFootprintGroups() {
    globeButton?.addEventListener('click', () => openFootprintGroups(globeButton));
    mapButton?.addEventListener('click', () => openFootprintGroups(mapButton));

    document.addEventListener('footprints:loaded', () => {
        refreshResolvedGroups();
        if (wishLayerVisible) deps.setWishLayerVisible?.(true, wishes);
        if (view && view.classList.contains('show')) {
            if (activeWish) renderWishDetail();
            else if (activeGroup) renderDetail();
            else renderList();
        }
    });
    document.addEventListener('footprint:view-mode-changed', () => {
        syncWishSceneModeControl();
        if (activeWish && activeFromMap && !view.classList.contains('show')) {
            deps.showWishOnMap?.(activeWish);
        } else if (activeGroup && activeFromMap && !view.classList.contains('show')) {
            deps.applyGroupOnMap(activeGroup);
        } else if (wishLayerVisible) {
            deps.setWishLayerVisible?.(true, wishes);
        }
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'groups') {
        const wait = () => {
            if (!deps.dataReady()) {
                setTimeout(wait, 80);
                return;
            }
            openFootprintGroups(null, {
                groupKey: params.get('group') || '',
                wishKey: params.get('wish') || '',
                syncUrl: false
            });
        };
        wait();
    }

    window.addEventListener('popstate', () => {
        const current = new URLSearchParams(window.location.search);
        if (current.get('view') === 'groups') {
            const key = current.get('group') || '';
            const wishKey = current.get('wish') || '';
            if (!view.classList.contains('show')) {
                openFootprintGroups(null, { groupKey: key, wishKey, syncUrl: false });
            }
            else if (wishKey) openWishDetail(wishKey, false, false, false);
            else if (key) openDetail(key, false);
            else {
                activeGroup = null;
                activeWish = null;
                renderList({ restore: true });
                announce('已返回旅途集列表');
            }
        } else if (view.classList.contains('show')) {
            closeFootprintGroups(false);
        } else if (activeGroup && activeFromMap) {
            clearMapGroup();
        }
    });
}

export function footprintGroupsVisible() {
    return !!(view && view.classList.contains('show'));
}
