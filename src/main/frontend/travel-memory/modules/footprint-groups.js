/**
 * 前台“行程与集合”全屏覆盖层。
 *
 * 负责列表、详情、深链、分享和成员入口；地图高亮与路线由宿主注入。
 */

import {
    groupDistanceText,
    resolveFootprintGroups
} from './footprint-group-model.js';

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
const liveRegion = document.getElementById('footprintGroupsLive');
const globeButton = document.getElementById('footprintGroupsBtn');
const mapButton = document.getElementById('groupGalleryBtn2d');

const MEMBER_PAGE_SIZE = 24;
const BACKGROUND_INERT_IDS = ['topNav', 'view-3d', 'view-2d', 'backGlobeBtn', 'cityFillFloatBtn'];

let deps = null;
let groups = [];
let activeFilter = 'all';
let searchQuery = '';
let activeGroup = null;
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
    const match = String(value || '').match(
        /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/
    );
    if (!match) return '时间未知';
    const date = match[1] + '.' + match[2] + '.' + match[3];
    return withTime && match[4] ? date + ' ' + match[4] + ':' + match[5] : date;
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

function typeText(group) {
    return group.groupType === 'trip' ? '行程' : '集合';
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
}

function filteredGroups() {
    const keyword = searchQuery.trim().toLowerCase();
    return groups.filter(group => {
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
}

function filterCounts() {
    return {
        all: groups.length,
        trip: groups.filter(group => group.groupType === 'trip').length,
        collection: groups.filter(group => group.groupType === 'collection').length
    };
}

function cardHtml(group) {
    const types = group.footprintTypes
        .map(type => `<span class="group-chip">${escapeHtml(type)}</span>`)
        .join('');
    return `
        <article class="group-library-card">
            <button type="button" class="group-library-card-hit" data-group-key="${escapeHtml(group.key)}"
                aria-label="打开${escapeHtml(typeText(group))}：${escapeHtml(group.title)}"></button>
            <div class="group-library-cover">
                ${group.cover
                    ? `<img src="${escapeHtml(group.cover)}" alt="" loading="lazy">`
                    : `<span aria-hidden="true">${escapeHtml(group.title.slice(0, 1))}</span>`}
                <b>${escapeHtml(typeText(group))}</b>
            </div>
            <div class="group-library-card-body">
                <div class="group-library-card-heading">
                    <h3>${escapeHtml(group.title)}</h3>
                    <span>${escapeHtml(progressText(group))}</span>
                </div>
                <p>${escapeHtml(group.description || rangeText(group))}</p>
                ${types ? `<div class="group-library-types">${types}</div>` : ''}
                <dl>
                    <div><dt>时间</dt><dd>${escapeHtml(cardRangeText(group))}</dd></div>
                    <div><dt>覆盖</dt><dd>${group.cityCount} 座城市 · ${group.provinceCount} 个省份</dd></div>
                </dl>
                ${group.missingCount ? `<small>${group.missingCount} 个成员足迹已失效</small>` : ''}
            </div>
            <span class="group-library-card-open" aria-hidden="true">查看 <i>→</i></span>
        </article>`;
}

function listItemsHtml() {
    if (deepLinkError === 'unavailable') {
        return `<div class="group-library-empty" role="alert">
            <h3>记录不存在或尚未公开</h3>
            <p>这个链接可能已被删除、改为私密，或者地址不完整。</p>
            <button type="button" class="fp-btn" data-clear-deep-link>查看全部行程与集合</button>
        </div>`;
    }
    const items = filteredGroups();
    return items.length
        ? items.map(cardHtml).join('')
        : `<div class="group-library-empty">
            <h3>${groups.length ? '没有符合筛选的记录' : '还没有行程或集合'}</h3>
            <p>${groups.length ? '切换到其他类型看看。' : '在后台从已有足迹中创建第一段旅程或主题收藏。'}</p>
        </div>`;
}

function bindGroupCards() {
    view.querySelectorAll('[data-group-key]').forEach(button => {
        button.addEventListener('click', () => openDetail(button.dataset.groupKey, true));
    });
    view.querySelector('[data-clear-deep-link]')?.addEventListener('click', () => {
        deepLinkError = '';
        setUrl(false, true);
        renderList();
        view.querySelector('#footprintGroupsBack')?.focus({ preventScroll: true });
        announce('已显示全部行程与集合');
    });
}

function renderListItems() {
    const list = view?.querySelector('.group-library-list');
    if (!list) return;
    list.innerHTML = listItemsHtml();
    bindGroupCards();
}

function syncFilterButtons() {
    view?.querySelectorAll('[data-group-filter]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.groupFilter === activeFilter));
    });
}

function renderList(options = {}) {
    if (!view) return;
    const counts = filterCounts();
    view.innerHTML = `
        <header class="group-library-top">
            <button id="footprintGroupsBack" class="fp-btn" type="button" aria-label="返回地图">
                <span aria-hidden="true">←</span><span>返回地图</span>
            </button>
            <div class="group-library-title">
                <p>旅行组合</p>
                <h2>行程与集合</h2>
                <span>${groups.length} 个记录</span>
            </div>
        </header>
        <div class="group-library-filterbar">
            <nav class="group-library-filters" aria-label="筛选行程与集合">
                ${[
                    ['all', '全部'],
                    ['trip', '行程'],
                    ['collection', '集合']
                ].map(([key, label]) => `
                    <button type="button" data-group-filter="${key}"
                        aria-pressed="${activeFilter === key}">
                        <span>${label}</span><b>${counts[key]}</b>
                    </button>
                `).join('')}
            </nav>
            <label class="group-library-search">
                <span class="sr-only">搜索行程与集合</span>
                <input type="search" value="${escapeHtml(searchQuery)}"
                    placeholder="搜索标题、地点或足迹类型" autocomplete="off">
            </label>
        </div>
        <div class="group-library-list"></div>`;
    renderListItems();
    view.querySelector('#footprintGroupsBack')?.addEventListener('click', () => closeFootprintGroups());
    view.querySelectorAll('[data-group-filter]').forEach(button => {
        button.addEventListener('click', () => {
            activeFilter = button.dataset.groupFilter || 'all';
            syncFilterButtons();
            renderListItems();
            const list = view.querySelector('.group-library-list');
            if (list) list.scrollTop = 0;
            button.focus({ preventScroll: true });
            announce(`已切换到${button.querySelector('span')?.textContent || '全部'}，共 ${filteredGroups().length} 条`);
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
            <span class="group-member-index" aria-hidden="true">${index + 1}</span>
            <button type="button" class="group-member-main" data-member-key="${escapeHtml(member.key)}"
                aria-label="查看第 ${index + 1} 站：${escapeHtml(member.name)}">
                <span class="group-member-photo">
                    ${image
                        ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">`
                        : `<span aria-hidden="true">${escapeHtml((member.city || member.name).slice(0, 1))}</span>`}
                </span>
                <span class="group-member-copy">
                    <strong>${escapeHtml(member.name)}</strong>
                    <span>${escapeHtml([member.city, member.province].filter(Boolean).join(' / ') || '未解析地区')}</span>
                    <time datetime="${escapeHtml(member.createTime)}">${escapeHtml(formatDate(member.createTime, true))}</time>
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
        <button type="button" class="group-collection-card" data-member-key="${escapeHtml(member.key)}"
            aria-label="查看第 ${index + 1} 个收藏：${escapeHtml(member.name)}">
            <span class="group-collection-photo">
                ${image
                    ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">`
                    : `<span aria-hidden="true">${escapeHtml((member.city || member.name).slice(0, 1))}</span>`}
            </span>
            <span><b>${escapeHtml(member.name)}</b>
            <small>${escapeHtml([member.city, member.province].filter(Boolean).join(' / ') || '未解析地区')}</small></span>
            <i>${index + 1}</i>
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
        backLabel: '返回行程',
        onClose: () => {
            activeGroup = group;
            activeFromMap = false;
            showOverlay();
            renderDetail();
            announce(`已返回${typeText(group)}：${group.title}`);
        }
    });
}

function renderDetail() {
    if (!view || !activeGroup) return;
    const group = activeGroup;
    visibleMemberCount = Math.min(
        Math.max(visibleMemberCount, MEMBER_PAGE_SIZE),
        group.members.length
    );
    const article = safeLink(group.article);
    const types = group.footprintTypes
        .map(type => `<span class="group-chip">${escapeHtml(type)}</span>`)
        .join('');
    const allMembersMissing = group.names.length > 0 && group.members.length === 0;
    const body = group.members.length
        ? `<${group.groupType === 'trip' ? 'ol' : 'div'}
                id="groupMemberList"
                class="${group.groupType === 'trip' ? 'group-trip-list' : 'group-collection-grid'}">
                ${memberBatchHtml(group, 0, visibleMemberCount)}
            </${group.groupType === 'trip' ? 'ol' : 'div'}>
            ${memberMoreHtml(group)}`
        : `<div class="group-library-empty">
            <h3>${allMembersMissing ? '成员足迹已全部失效' : '这个集合还没有成员'}</h3>
            <p>${allMembersMissing
                ? '请在后台编辑这个集合，移除失效引用或补充新的足迹。'
                : '在后台编辑集合，从已有足迹中挑选地点。'}</p>
        </div>`;

    view.innerHTML = `
        <header class="group-library-top">
            <button id="footprintGroupsBack" class="fp-btn" type="button" aria-label="返回行程与集合列表">
                <span aria-hidden="true">←</span><span>${activeFromMap ? '返回地图' : '全部记录'}</span>
            </button>
            <div id="groupDetailCompactTitle" class="group-detail-compact-title" hidden>
                <span>${escapeHtml(typeText(group))}</span>
                <strong>${escapeHtml(group.title)}</strong>
            </div>
            <div class="group-library-actions">
                ${activeFromMap
                    ? '<button id="footprintGroupsAll" class="fp-btn" type="button">全部记录</button>'
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
        <article class="group-detail" tabindex="-1">
            <div class="group-detail-hero">
                <div class="group-detail-cover">
                    ${group.cover
                        ? `<img src="${escapeHtml(group.cover)}" alt="" loading="lazy">`
                        : `<span aria-hidden="true">${escapeHtml(group.title.slice(0, 1))}</span>`}
                </div>
                <div class="group-detail-heading">
                    <p>${escapeHtml(typeText(group))}${group.visibility === 'private' ? ' · 私密' : ''}</p>
                    <h2>${escapeHtml(group.title)}</h2>
                    ${types ? `<div class="group-library-types">${types}</div>` : ''}
                    <p class="group-detail-description">${escapeHtml(group.description || '这段旅行还没有补上说明。')}</p>
                    <dl class="group-detail-stats">
                        <div><dt>${group.groupType === 'trip' ? '日期' : '完成度'}</dt>
                            <dd>${escapeHtml(group.groupType === 'trip' ? rangeText(group) : progressText(group))}</dd></div>
                        <div><dt>成员</dt><dd>${group.members.length} 条</dd></div>
                        <div><dt>覆盖</dt><dd>${group.cityCount} 座城市，${group.provinceCount} 个省份</dd></div>
                        ${group.groupType === 'trip'
                            ? `<div><dt>直线距离</dt><dd>${Math.round(group.distanceKm).toLocaleString('zh-CN')} 公里</dd></div>`
                            : ''}
                    </dl>
                    ${group.missingCount ? `<p class="group-detail-warning">${group.missingCount} 个成员足迹已失效，统计中已跳过。</p>` : ''}
                    ${group.unlocatableCount ? `<p class="group-detail-warning">${group.unlocatableCount} 个成员缺少有效坐标，地图和距离统计中已跳过。</p>` : ''}
                </div>
            </div>
            <section class="group-detail-body" aria-label="${escapeHtml(typeText(group))}成员">
                ${body}
            </section>
        </article>`;

    view.querySelector('#footprintGroupsBack')?.addEventListener('click', () => {
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

function setUrl(detail, replace = false) {
    if (!window.location.pathname.endsWith('/footprints')) return;
    const params = new URLSearchParams();
    params.set('view', 'groups');
    if (detail && activeGroup) params.set('group', activeGroup.key);
    const method = replace ? 'replaceState' : 'pushState';
    history[method]({ footprintGroups: true }, '', window.location.pathname + '?' + params.toString());
}

function applyMapView(group) {
    activeGroup = group;
    activeFromMap = true;
    closeOverlay(false);
    document.body.classList.add('footprint-group-map-mode');
    deps.applyGroupOnMap(group);
    globeButton?.setAttribute('aria-pressed', 'true');
    mapButton?.setAttribute('aria-pressed', 'true');
    mapMemberIndex = 0;
    mapMemberActivated = false;
    updateMapDock();
    if (mapDock) mapDock.hidden = false;
    announce(`正在查看${group.title}的${typeText(group)}地图`);
}

function viewOnMap() {
    if (!activeGroup) return;
    detailScrollTop = view.querySelector('.group-detail')?.scrollTop || detailScrollTop;
    applyMapView(activeGroup);
}

function returnToList() {
    activeGroup = null;
    activeFromMap = false;
    detailScrollTop = 0;
    setUrl(false, true);
    renderList({ restore: true });
    announce('已返回行程与集合列表');
}

function clearMapGroup() {
    clearTimeout(mapFocusTimer);
    deps.clearGroupOnMap();
    activeFromMap = false;
    mapMemberActivated = false;
    document.body.classList.remove('footprint-group-map-mode');
    if (mapDock) mapDock.hidden = true;
    globeButton?.setAttribute('aria-pressed', 'false');
    mapButton?.setAttribute('aria-pressed', 'false');
    if (!view.classList.contains('show')) activeGroup = null;
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
    announce('已退出行程地图查看');
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
    copied = false;
    deepLinkError = '';
    showOverlay();
    if (options.groupKey) {
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

function openDetail(key, updateUrl = true, fromRoute = false, restoreDetail = false) {
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
    activeFromMap = fromRoute;
    copied = false;
    deepLinkError = '';
    if (updateUrl) setUrl(true);
    if (mapDock) mapDock.hidden = true;
    renderDetail();
    announce(`已打开${typeText(group)}：${group.title}`);
}

export function closeFootprintGroups(restoreFocus = true) {
    if ((!view || !view.classList.contains('show')) && !activeFromMap) return false;
    clearMapGroup();
    activeGroup = null;
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
            if (!activeGroup) return;
            deps.clearGroupOnMap();
            showOverlay();
            openDetail(activeGroup.key, false, true, true);
        });
    }
    mapDockPrev?.addEventListener('click', () => stepMapMember(-1));
    mapDockNext?.addEventListener('click', () => stepMapMember(1));
    mapDockExit?.addEventListener('click', exitGroupMap);
    if (view) {
        view.addEventListener('click', event => {
            if (event.target === view) closeFootprintGroups();
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
        if (view && view.classList.contains('show')) {
            if (activeGroup) renderDetail();
            else renderList();
        }
    });
    document.addEventListener('footprint:view-mode-changed', () => {
        if (activeGroup && activeFromMap && !view.classList.contains('show')) {
            deps.applyGroupOnMap(activeGroup);
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
                syncUrl: false
            });
        };
        wait();
    }

    window.addEventListener('popstate', () => {
        const current = new URLSearchParams(window.location.search);
        if (current.get('view') === 'groups') {
            const key = current.get('group') || '';
            if (!view.classList.contains('show')) {
                openFootprintGroups(null, { groupKey: key, syncUrl: false });
            }
            else if (key) openDetail(key, false);
            else {
                activeGroup = null;
                renderList({ restore: true });
                announce('已返回行程与集合列表');
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
