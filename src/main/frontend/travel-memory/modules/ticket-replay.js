/**
 * 重走一遍（阶段 D）：按时间顺序逐站放映票根，相机飞往每一站，结束后给出统计卡。
 *
 * 从 ticket-gallery.js 拆出。票夹 / 重走的模式切换（setTicketViewMode）留在 ticket-gallery.js，
 * 这里负责放映本身；模式值存在 ticket-state.js。
 */

import { haversineKm } from './footprints-insight.js';
import { ticketHasCoordinate, isSameTicketCity } from './ticket-utils.js';
import {
    ticketGallery,
    ticketModeArchiveBtn,
    ticketModeReplayBtn,
    ticketReplayBarInner,
    ticketReplayCard,
    ticketReplayCityBadge,
    ticketReplayDistance,
    ticketReplayEnd,
    ticketReplayEndCities,
    ticketReplayEndKm,
    ticketReplayEndNote,
    ticketReplayEndRange,
    ticketReplayEndSpan,
    ticketReplayEndTickets,
    ticketReplayEta,
    ticketReplayFlight,
    ticketReplayFlightCity,
    ticketReplayFlightFrom,
    ticketReplayFlightKm,
    ticketReplayFlightLabel,
    ticketReplayPlay,
    ticketReplayProgressText,
    ticketReplayRoute,
    ticketReplaySpeed,
    ticketReplaySubtitle,
    ticketReplayTotal,
    ticketReplayView,
    ticketViewModes
} from './ticket-dom.js';
import { ticketImageUrl, ticketMeta } from './ticket-format.js';
import {
    getTicketIndex,
    getTicketItems,
    getTicketViewMode,
    setTicketIndex,
    sortedTicketItems,
    ticketFeatureOn
} from './ticket-state.js';
import { applyTicketSeason } from './ticket-passport.js';

let deps = null;

/**
 * @param {object} d 依赖集合（由 setupTicketGallery 从宿主注入里挑出本模块要用的键转发）
 * @param d.footprints                    () => Footprint[]
 * @param d.cityKeyOf                     (fp) => string
 * @param d.viewer                        () => Cesium.Viewer
 * @param d.reduceMotion                  () => boolean
 * @param d.pauseAutoRotate / d.resumeAutoRotate
 */
export function setupTicketReplay(d) {
    deps = d;
}

let ticketReplayItems = [];
let ticketReplayPoints = [];
let ticketReplayIndex = 0;
let ticketReplayPlaying = false;
let ticketReplayFlying = false;
let ticketReplayTimer = null;
let ticketReplayGeneration = 0;
let ticketReplayEntryIndex = 0;              // 进入放映时的票根，退出后回到这一张
let ticketReplayResumeIndex = -1;            // 切回票夹后，重走再进来接着播的位置
let ticketReplayPausedByOverlay = false;     // 浮层（护照/抽票/明信片）暂停放映的标记
let ticketReplaySpeedValue = 1;              // 播放倍速：1 或 2
const TICKET_REPLAY_DWELL_MS = 4200;

export function updateTicketModeButtons() {
    if (!ticketViewModes) return;
    const replayEnabled = ticketFeatureOn('enableTicketJourneyReplay') &&
        getTicketItems().filter(ticketHasCoordinate).length >= 2;
    ticketViewModes.hidden = !replayEnabled;
    if (!replayEnabled) return;
    // 只剩重走一个模式：顶部就是「票夹 / 重走」两段切换器（方案 §10）
    if (ticketModeArchiveBtn) ticketModeArchiveBtn.hidden = false;
    if (ticketModeReplayBtn) ticketModeReplayBtn.hidden = false;
    const active = getTicketViewMode() === 'replay' ? 'replay' : 'archive';
    if (ticketModeArchiveBtn) ticketModeArchiveBtn.classList.toggle('is-active', active === 'archive');
    if (ticketModeReplayBtn) ticketModeReplayBtn.classList.toggle('is-active', active === 'replay');
}

// ================= 重走一遍（阶段 D） =================
function updateTicketReplayPlayButton() {
    if (ticketReplayPlay) {
        ticketReplayPlay.textContent = ticketReplayPlaying ? '暂停' : '继续';
    }
}

function updateTicketReplaySpeedButton() {
    if (!ticketReplaySpeed) return;
    ticketReplaySpeed.textContent = ticketReplaySpeedValue + '×';
    ticketReplaySpeed.setAttribute('aria-label', '播放速度，当前 ' + ticketReplaySpeedValue + ' 倍速');
    ticketReplaySpeed.classList.toggle('is-on', ticketReplaySpeedValue > 1);
}

export function toggleTicketReplaySpeed() {
    ticketReplaySpeedValue = ticketReplaySpeedValue > 1 ? 1 : 2;
    updateTicketReplaySpeedButton();
    // 正在放映就按新倍速重排下一段（当前停留重新计时，不跳站）
    if (ticketReplayPlaying) scheduleNextTicketReplay();
    if (ticketReplayEta) ticketReplayEta.textContent = ticketReplayRemainingText();
}

// 剩余时间：按「停留 + 飞行 + 落卡停顿」的整段估算，同城/缺坐标的段会更快，所以标「约」
function ticketReplayRemainingText() {
    const len = ticketReplayPoints.length;
    const left = Math.max(0, len - 1 - ticketReplayIndex);
    if (!left) return '';
    const perStopMs = (TICKET_REPLAY_DWELL_MS + 2300 + 480) / ticketReplaySpeedValue;
    const seconds = Math.round(left * perStopMs / 1000);
    return '剩余约 ' + (seconds >= 90 ? Math.round(seconds / 60) + ' 分钟' : seconds + ' 秒');
}

function ticketReplayFlyTo(fp, duration, onDone) {
    if (!fp || !ticketHasCoordinate(fp)) {
        // 没有坐标时不飞：仍回调，避免调用方把 ticketReplayFlying 卡在 true
        if (onDone) onDone();
        return;
    }
    const target = Cesium.Cartesian3.fromDegrees(Number(fp.lng), Number(fp.lat), 150000);
    const dur = deps.reduceMotion() ? 0 : Math.max(0, duration || 0);
    if (dur <= 0) {
        deps.viewer().camera.flyTo({ destination: target, duration: 0 });
        if (onDone) onDone();
        return;
    }
    deps.viewer().camera.flyTo({
        destination: target,
        duration: dur,
        complete: onDone || undefined,
        cancel: onDone || undefined
    });
}

// 相机飞行是异步的：暂停/改站/退出时必须显式取消，
// 否则镜头会继续飞向已经放弃的目标（票夹已经回来了，地球还在动）
function cancelTicketReplayFlight() {
    try {
        deps.viewer().camera.cancelFlight();
    } catch (e) {
        /* 相机未在飞行或场景尚未就绪时忽略 */
    }
}

function ticketReplayShowStop(index, animate) {
    const points = ticketReplayPoints;
    if (!points.length) return;
    const len = points.length;
    ticketReplayIndex = Math.max(0, Math.min(index, len - 1));
    const fp = points[ticketReplayIndex];
    // 放映期间不改写票夹游标；退出时由 clearTicketReplay 复位到进入前的票根

    ticketReplayCard.classList.remove('is-arriving', 'is-missing');
    ticketReplayCard.innerHTML = '';
    const img = document.createElement('img');
    img.alt = fp.ticketTitle || fp.name || '票根';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onerror = () => {
        ticketReplayCard.classList.add('is-missing');
        ticketReplayCard.textContent = (fp.city || fp.name || '?').charAt(0);
    };
    img.src = ticketImageUrl(fp.ticketImage);
    ticketReplayCard.appendChild(img);
    if (animate) {
        void ticketReplayCard.offsetWidth;
        ticketReplayCard.classList.add('is-arriving');
    }

    const meta = ticketMeta(fp);
    ticketReplaySubtitle.textContent = [fp.name || meta.title, fp.city || meta.route, meta.date]
        .filter(Boolean).join('，');
    // 时间有色：氛围色跟随当前放映到的那一张票根
    applyTicketSeason(fp);
    // 第二行拆成「状态文字 + 里程数字」两块：数字单独给强调色与等宽数字，移动中更醒目
    let routeText;
    let distanceText = '';
    if (ticketReplayIndex === 0) {
        routeText = ticketHasCoordinate(fp) ? '第一站' : '第一站，这条足迹没有坐标';
    } else {
        const prev = points[ticketReplayIndex - 1];
        const sameCity = isSameTicketCity(prev, fp);
        const noCoord = !ticketHasCoordinate(prev) || !ticketHasCoordinate(fp);
        if (noCoord) {
            routeText = '这一段缺少坐标，不飞行';
        } else if (sameCity) {
            routeText = '与上一站同城';
        } else {
            routeText = '已到达';
            distanceText = '距上一站 ' + Math.round(haversineKm(prev, fp)).toLocaleString('zh-CN') + ' 公里';
        }
    }
    ticketReplayRoute.textContent = routeText;
    if (ticketReplayDistance) {
        ticketReplayDistance.textContent = distanceText;
    }
    // 同城角标：这座城市在本次重走里有多张票根时，标出这是第几张
    if (ticketReplayCityBadge) {
        const key = deps.cityKeyOf(fp);
        let badge = '';
        if (key) {
            const group = ticketReplayPoints.filter(item => deps.cityKeyOf(item) === key);
            if (group.length > 1) {
                const position = group.indexOf(fp) + 1;
                badge = (String(fp.city || '').trim() || '这座城市') + '第 ' + position + ' 张，共 ' + group.length + ' 张';
            }
        }
        ticketReplayCityBadge.textContent = badge;
        ticketReplayCityBadge.hidden = !badge;
    }
    const totalKm = ticketReplayKilometers(ticketReplayIndex);
    ticketReplayProgressText.textContent = (ticketReplayIndex + 1) + ' / ' + len;
    // 累计里程和「距上一站」放在同一行，进度区只留进度与剩余时间
    if (ticketReplayTotal) {
        ticketReplayTotal.textContent = totalKm > 0
            ? '累计 ' + Math.round(totalKm).toLocaleString('zh-CN') + ' 公里'
            : '';
    }
    if (ticketReplayEta) {
        ticketReplayEta.textContent = ticketReplayRemainingText();
    }
    if (ticketReplayBarInner) {
        /* 进度条走 transform: scaleX，别动 width（宽度动画会触发重排） */
        ticketReplayBarInner.style.transform = 'scaleX(' + ((ticketReplayIndex + 1) / len) + ')';
    }
    // 预加载下一张，避免飞行落地后才开始解码
    const next = points[ticketReplayIndex + 1];
    if (next) {
        const pre = new Image();
        pre.src = ticketImageUrl(next.ticketImage);
    }
}

// 从第一张票根累加到第 upTo 张的直线估算里程。
// 缺坐标的段和「同城段」都跳过：界面上这两类段也不显示里程，累计口径保持一致
function ticketReplayKilometers(upTo) {
    const points = ticketReplayPoints;
    const end = Math.min(upTo, points.length - 1);
    let km = 0;
    for (let i = 1; i <= end; i++) {
        const from = points[i - 1];
        const to = points[i];
        if (!ticketHasCoordinate(from) || !ticketHasCoordinate(to)) continue;
        if (isSameTicketCity(from, to)) continue;
        km += haversineKm(from, to);
    }
    return km;
}

function ticketReplayShowFlight(from, to, kmValue, flightSeconds) {
    if (!ticketReplayFlight) return;
    if (ticketReplayView) ticketReplayView.classList.add('is-flying');
    // 进度条动画时长跟着实际飞行时长走（变速时同步）
    ticketReplayFlight.style.setProperty('--flight-duration', (flightSeconds || 2.3) + 's');
    const km = kmValue ? Math.round(kmValue).toLocaleString('zh-CN') + ' 公里' : '';
    ticketReplayFlightLabel.textContent = '正在飞往';
    if (ticketReplayFlightFrom) {
        ticketReplayFlightFrom.textContent = (from && (from.city || from.name)) || '上一站';
    }
    ticketReplayFlightCity.textContent = to.city || to.name || '下一站';
    ticketReplayFlightKm.textContent = km ? '直线约 ' + km : '';
    // 每次起飞都重放一次进度条：先摘掉 is-on 再强制重排
    ticketReplayFlight.classList.remove('is-on');
    void ticketReplayFlight.offsetWidth;
    ticketReplayFlight.classList.add('is-on');
    ticketReplayFlight.setAttribute('aria-hidden', 'false');
    // 底部影院条同步跟着走：状态行说去哪个城市，里程行显示这一段
    if (ticketReplayRoute) {
        ticketReplayRoute.textContent = '正在飞往 ' + (to.city || to.name || '下一站');
    }
    if (ticketReplayDistance) {
        ticketReplayDistance.textContent = km ? '约 ' + km : '';
    }
}

function ticketReplayHideFlight() {
    if (ticketReplayFlight) {
        ticketReplayFlight.classList.remove('is-on');
        ticketReplayFlight.setAttribute('aria-hidden', 'true');
    }
    if (ticketReplayView) ticketReplayView.classList.remove('is-flying');
}

// 票根放大 / 收起：只有用户明确点票根才会放大（方案 A）
export function ticketReplaySetZoom(zoom) {
    if (!ticketReplayView || !ticketReplayCard) return;
    ticketReplayView.classList.toggle('is-focused', !!zoom);
    ticketReplayCard.setAttribute('aria-expanded', zoom ? 'true' : 'false');
    ticketReplayCard.setAttribute('aria-label', zoom ? '收起票根' : '放大票根');
}

export function toggleTicketReplayZoom() {
    if (getTicketViewMode() !== 'replay' || !ticketReplayCard) return;
    // 飞行途中卡片是淡出的，这时不允许（键盘）触发放大
    if (ticketReplayView.classList.contains('is-flying')) return;
    const zoomed = ticketReplayView.classList.contains('is-focused');
    if (zoomed) {
        ticketReplaySetZoom(false);
        return;
    }
    // 点票根的意思就是「停下来让我看清这张」：正在放映就先暂停
    if (ticketReplayPlaying) pauseTicketReplay();
    ticketReplaySetZoom(true);
}

function scheduleNextTicketReplay() {
    clearTimeout(ticketReplayTimer);
    ticketReplayTimer = null;
    if (!ticketReplayPlaying || getTicketViewMode() !== 'replay') return;
    const gen = ticketReplayGeneration;
    const rate = ticketReplaySpeedValue;
    ticketReplayTimer = setTimeout(() => {
        if (gen !== ticketReplayGeneration || !ticketReplayPlaying || ticketReplayFlying) return;
        const points = ticketReplayPoints;
        const next = ticketReplayIndex + 1;
        if (next >= points.length) {
            finishTicketReplay();
            return;
        }
        const from = points[ticketReplayIndex];
        const to = points[next];
        const sameCity = isSameTicketCity(from, to);
        const noCoord = !ticketHasCoordinate(from) || !ticketHasCoordinate(to);
        if (sameCity || noCoord) {
            ticketReplayTimer = setTimeout(() => {
                if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                ticketReplayHideFlight();
                ticketReplayShowStop(next, true);
                scheduleNextTicketReplay();
            }, 520 / rate);
        } else {
            const km = haversineKm(from, to);
            const flightSeconds = 2.3 / rate;
            ticketReplayFlying = true;
            ticketReplayShowFlight(from, to, km, flightSeconds);
            ticketReplayFlyTo(to, flightSeconds, () => {
                if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                ticketReplayFlying = false;
                ticketReplayTimer = setTimeout(() => {
                    if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                    ticketReplayHideFlight();
                    ticketReplayShowStop(next, true);
                    scheduleNextTicketReplay();
                }, 480 / rate);
            });
        }
    }, TICKET_REPLAY_DWELL_MS / rate);
}

export function pauseTicketReplay() {
    if (!ticketReplayPlaying) return;
    ticketReplayGeneration++;
    ticketReplayPlaying = false;
    clearTimeout(ticketReplayTimer);
    ticketReplayTimer = null;
    ticketReplayFlying = false;
    cancelTicketReplayFlight();
    ticketReplayHideFlight();
    // 方案 A：暂停只冻结当前画面，不再把票根搬到画面中央
    if (ticketReplayView) ticketReplayView.classList.add('is-paused');
    updateTicketReplayPlayButton();
}

export function resumeTicketReplay() {
    if (ticketReplayPlaying || !ticketReplayPoints.length || getTicketViewMode() !== 'replay') return;
    if (!ticketReplayEnd.hidden) return;
    ticketReplayGeneration++;
    ticketReplayPlaying = true;
    updateTicketReplayPlayButton();
    if (ticketReplayView) ticketReplayView.classList.remove('is-paused');
    ticketReplaySetZoom(false);
    ticketReplayShowStop(ticketReplayIndex, false);
    scheduleNextTicketReplay();
}

// 抽票/护照/明信片浮层打开时暂停放映，关闭后接着播，不丢播放位置
export function pauseTicketReplayForOverlay() {
    if (getTicketViewMode() !== 'replay' || !ticketReplayPlaying) return;
    ticketReplayPausedByOverlay = true;
    pauseTicketReplay();
}

export function resumeTicketReplayFromOverlay() {
    if (!ticketReplayPausedByOverlay) return;
    ticketReplayPausedByOverlay = false;
    if (getTicketViewMode() !== 'replay' || !ticketGallery.classList.contains('show')) return;
    if (!ticketReplayEnd.hidden) return;
    resumeTicketReplay();
}

// 手动上一站/下一站：卡片立即切换，同时把镜头带到这一站（缺坐标时保持原地）
function ticketReplayFlyToStop(index) {
    const fp = ticketReplayPoints[index];
    if (!ticketHasCoordinate(fp)) return;
    ticketReplayFlyTo(fp, 1.4, null);
}

export function stepTicketReplay(delta) {
    if (!ticketReplayPoints.length || !ticketReplayEnd.hidden) return;
    const wasPlaying = ticketReplayPlaying;
    pauseTicketReplay();
    const len = ticketReplayPoints.length;
    const next = (ticketReplayIndex + delta + len) % len;
    // 播放中不重复触发落卡动画：紧接着的 resume 会重绘当前卡片
    ticketReplayShowStop(next, !wasPlaying);
    ticketReplayFlyToStop(next);
    if (wasPlaying) resumeTicketReplay();
}

function finishTicketReplay() {
    if (!ticketReplayEnd) return;
    ticketReplayGeneration++;
    ticketReplayPlaying = false;
    clearTimeout(ticketReplayTimer);
    ticketReplayTimer = null;
    ticketReplayFlying = false;
    ticketReplayHideFlight();
    updateTicketReplayPlayButton();
    const points = ticketReplayPoints;
    const km = ticketReplayKilometers(points.length - 1);
    const cities = new Set(points.map(fp => fp.city).filter(Boolean));
    const first = points[0];
    const last = points[points.length - 1];
    const stamp = fp => {
        const raw = String(fp.ticketDate || fp.createTime || '').slice(0, 10);
        return raw ? raw.replace(/-/g, '.') : '';
    };
    const yearOf = fp => Number(String(fp.ticketDate || fp.createTime || '').slice(0, 4));
    const yearA = yearOf(first);
    const yearB = yearOf(last);
    if (ticketReplayEndRange) {
        const from = stamp(first);
        const to = stamp(last);
        ticketReplayEndRange.textContent = (from && to && from !== to) ? from + ' 到 ' + to : (from || '');
    }
    if (ticketReplayEndTickets) ticketReplayEndTickets.textContent = String(points.length);
    if (ticketReplayEndCities) ticketReplayEndCities.textContent = cities.size ? String(cities.size) : '—';
    if (ticketReplayEndKm) ticketReplayEndKm.textContent = Math.round(km).toLocaleString('zh-CN');
    if (ticketReplayEndSpan) {
        ticketReplayEndSpan.textContent = (yearA && yearB && yearB >= yearA)
            ? String(yearB - yearA + 1)
            : '—';
    }
    // 重走只放映「带票根图」的足迹，这里说明一下总数，免得用户以为别的足迹丢了
    if (ticketReplayEndNote) {
        const withoutTicket = Math.max(0, deps.footprints().length - getTicketItems().length);
        ticketReplayEndNote.textContent = withoutTicket
            ? '只放映有票根图的足迹，另有 ' + withoutTicket + ' 条足迹没有票根图'
            : '';
        ticketReplayEndNote.hidden = !withoutTicket;
    }
    ticketReplayEnd.hidden = false;
    if (ticketReplayView) ticketReplayView.classList.add('is-ended');
    ticketReplayResumeIndex = 0;   // 已播完：下次进重走从头开始，而不是停在终点卡
}

export function startTicketReplay(startIndex = 0) {
    if (!ticketReplayPoints.length) return;
    ticketReplayGeneration++;
    ticketReplayPlaying = true;
    ticketReplayFlying = false;
    const len = ticketReplayPoints.length;
    const start = Math.max(0, Math.min(Number(startIndex) || 0, len - 1));
    ticketReplayIndex = start;
    if (ticketReplayEnd) ticketReplayEnd.hidden = true;
    ticketReplayHideFlight();
    if (ticketReplayView) {
        ticketReplayView.classList.remove('is-focused', 'is-flying', 'is-paused', 'is-ended');
    }
    ticketReplaySetZoom(false);
    deps.pauseAutoRotate('replay');   // 放映期间暂停自转，退出放映时按用户偏好恢复
    ticketReplayShowStop(start, true);
    if (ticketHasCoordinate(ticketReplayPoints[start])) {
        ticketReplayFlyTo(ticketReplayPoints[start], 0.001, null);
    }
    scheduleNextTicketReplay();
    updateTicketReplayPlayButton();
}

// 至少两张带经纬度的票根才能放映（入口按钮与进入校验共用同一条件）
export function canEnterTicketReplay() {
    return !!ticketReplayView && getTicketItems().filter(ticketHasCoordinate).length >= 2;
}

export function enterTicketReplay() {
    if (!ticketReplayView) return;
    ticketReplayItems = sortedTicketItems();
    ticketReplayPoints = ticketReplayItems;
    if (!canEnterTicketReplay()) return;
    updateTicketReplaySpeedButton();
    // 只在真正进入放映时记录一次当前票根，退出时复位
    ticketReplayEntryIndex = getTicketIndex();
    ticketGallery.classList.add('is-replay-mode');
    ticketGallery.classList.remove('fp-sheet');   // 重走压在地球上，用夜图
    ticketReplayView.hidden = false;
    // 从票夹切回来时接着上次的站继续播（-1 表示从头开始）
    startTicketReplay(ticketReplayResumeIndex);
    updateTicketModeButtons();
}

export function clearTicketReplay() {
    const wasReplay = getTicketViewMode() === 'replay';
    ticketReplayGeneration++;
    ticketReplayPlaying = false;
    ticketReplayFlying = false;
    clearTimeout(ticketReplayTimer);
    ticketReplayTimer = null;
    cancelTicketReplayFlight();
    ticketReplayHideFlight();
    if (ticketReplayEnd) ticketReplayEnd.hidden = true;
    if (ticketReplayView) ticketReplayView.hidden = true;
    if (ticketReplayView) ticketReplayView.classList.remove('is-focused', 'is-flying', 'is-paused', 'is-ended');
    ticketReplaySetZoom(false);
    if (ticketGallery) {
        ticketGallery.classList.remove('is-replay-mode');
        ticketGallery.classList.add('fp-sheet');   // 回到票夹，换回白图
    }
    // 回到进入放映前的票根，不停留在最后看过的那一张；
    // 只有真的在放映中才复位，避免之后切模式时把票夹游标拽回旧位置
    if (wasReplay) {
        // 记下播到哪一站：切回票夹再进来能接着播
        ticketReplayResumeIndex = ticketReplayIndex;
        if (getTicketItems()[ticketReplayEntryIndex]) setTicketIndex(ticketReplayEntryIndex);
    }
    ticketReplayPausedByOverlay = false;
    deps.resumeAutoRotate('replay');   // 退出放映：按用户偏好恢复自转
    updateTicketReplayPlayButton();
}

// ---------- 取值 / 赋值（主文件的「查看这张票」、关闭票根页时用到） ----------
export function getTicketReplayPoints() {
    return ticketReplayPoints;
}
export function getTicketReplayIndex() {
    return ticketReplayIndex;
}
export function isTicketReplayPlaying() {
    return ticketReplayPlaying;
}
export function setTicketReplayResumeIndex(index) {
    ticketReplayResumeIndex = index;
}
export function setTicketReplayPausedByOverlay(value) {
    ticketReplayPausedByOverlay = value;
}
