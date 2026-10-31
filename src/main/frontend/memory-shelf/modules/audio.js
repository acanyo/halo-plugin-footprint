/**
 * 声音：音效文件池、静音与音量偏好、首次手势解锁。
 */

import { els, version } from './state.js';

// ==========================================================================
// 声音（照参考实现的音效系统，但**不引入任何音频资产**：全部用 WebAudio 现场合成）
// --------------------------------------------------------------------------
// 参考实现把环境曲与 5 个音效烘成 MP3 内嵌；我们没有音频资产，所以改成合成：
//   cloth 布面摩擦 / wood 木架轻磕 / hinge 铰链吱声 / page 翻页 / close 合书闷响
// 行为照参考：首次用户手势后才解锁、静音与音量写进 localStorage、
// 标签页隐藏时挂起、同时发声数封顶，避免连点把声音叠成噪音。
// ==========================================================================
var audio = {
    ctx: null, master: null, unlocked: false, muted: false, volume: 0.55,
    voices: 0, nodes: [], maxVoices: 4
};
var AUDIO_KEY = 'footprint-shelf-audio';

function audioLoadPrefs() {
    try {
        var raw = window.localStorage.getItem(AUDIO_KEY);
        if (!raw) return;
        var saved = JSON.parse(raw);
        if (typeof saved.muted === 'boolean') audio.muted = saved.muted;
        if (typeof saved.volume === 'number') {
            audio.volume = Math.max(0, Math.min(1, saved.volume));
        }
    } catch (e) { /* 隐私模式等拿不到 localStorage，忽略 */ }
}

function audioSavePrefs() {
    try {
        window.localStorage.setItem(AUDIO_KEY,
            JSON.stringify({ muted: audio.muted, volume: audio.volume }));
    } catch (e) { /* 忽略 */ }
}


// 合成一段声音：type = 噪声/正弦，滤波 + 包络
function audioBurst(options) {
    if (!audio.ctx || audio.muted || audio.voices >= audio.maxVoices) return;
    var ctx = audio.ctx;
    var now = ctx.currentTime;
    var dur = options.duration || 0.24;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, options.level || 0.2), now + (options.attack || 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    var filter = ctx.createBiquadFilter();
    filter.type = options.filterType || 'bandpass';
    filter.frequency.setValueAtTime(options.freq || 900, now);
    if (options.freqTo) {
        filter.frequency.exponentialRampToValueAtTime(options.freqTo, now + dur);
    }
    filter.Q.value = options.q || 1.1;

    var src = null;
    if (options.noise) {
        var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
        var buf = ctx.createBuffer(1, len, ctx.sampleRate);
        var ch = buf.getChannelData(0);
        for (var i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
        src = ctx.createBufferSource();
        src.buffer = buf;
    } else {
        src = ctx.createOscillator();
        src.type = options.wave || 'sine';
        src.frequency.setValueAtTime(options.tone || 220, now);
        if (options.toneTo) src.frequency.exponentialRampToValueAtTime(options.toneTo, now + dur);
    }
    src.connect(filter);
    filter.connect(gain);
    gain.connect(audio.master);
    src.start(now);
    src.stop(now + dur + 0.02);
    audio.voices += 1;
    src.onended = function () {
        audio.voices = Math.max(0, audio.voices - 1);
        try { gain.disconnect(); filter.disconnect(); } catch (e) { /* 忽略 */ }
    };
}

// 五个音效的配方（都是短促的合成，不依赖资产）
var AUDIO_CUES = {
    // 布面摩擦：高频噪声、很短
    cloth: { noise: true, freq: 2600, freqTo: 1400, q: 0.9, duration: 0.16, level: 0.10 },
    // 木架轻磕：低频方波一点，带木头的"咚"
    wood: { tone: 180, toneTo: 90, wave: 'triangle', duration: 0.18, level: 0.16, filterType: 'lowpass', freq: 700 },
    // 铰链：中频窄带扫过，像合页转动
    hinge: { noise: true, freq: 700, freqTo: 1500, q: 6, duration: 0.22, level: 0.07 },
    // 翻页：纸的沙沙声 + 一次轻微的"啪"
    page: { noise: true, freq: 1800, freqTo: 900, q: 1.2, duration: 0.26, level: 0.13 },
    // 合书：低闷响
    close: { tone: 110, toneTo: 60, wave: 'sine', duration: 0.34, level: 0.2, filterType: 'lowpass', freq: 420 }
};

// ---- 音效改成**播放音频文件**（static/audio/*.wav，随插件打包）----
// 实时合成那版在用户的浏览器里一直没出声，所以照参考实现的思路改成文件播放。
var AUDIO_FILES = {
    // 参考实现内嵌的音效（键名照它的代码：select / navigate / open / page / close），
    // 我们从它的 index.html 里解出成 mp3 放在 static/audio/ 下，随插件打包。
    // （环境曲 music 按用户要求去掉，只保留交互音效。）
    select: 'shelf-select.mp3',
    navigate: 'shelf-navigate.mp3',
    open: 'shelf-open.mp3',
    page: 'shelf-page.mp3',
    close: 'shelf-close.mp3'
};
var AUDIO_BASE = '/plugins/footprint/assets/static/audio/';
var AUDIO_POOL = 3;              // 每个音效 3 份：够快速连点，又不会叠成噪音
var audioPool = {};

function audioUrl(file) { return AUDIO_BASE + file + '?version=' + version; }

function ensureAudioPool() {
    if (audioPool.page) return;
    Object.keys(AUDIO_FILES).forEach(function (name) {
        var list = [];
        for (var i = 0; i < AUDIO_POOL; i++) {
            var el = new Audio(audioUrl(AUDIO_FILES[name]));
            el.preload = 'auto';
            el.volume = audio.muted ? 0 : audio.volume;
            list.push(el);
        }
        audioPool[name] = list;
    });
}

function applyAudioVolume() {
    Object.keys(audioPool).forEach(function (name) {
        audioPool[name].forEach(function (el) {
            el.volume = audio.muted ? 0 : audio.volume;
        });
    });
}

export function playCue(name, options) {
    // 兜底解锁：cue 的调用点本身就在事件处理里（点击/拖动），算用户手势。
    if (!audio.unlocked) unlockAudio();
    if (!audio.unlocked || audio.muted) return;
    var list = audioPool[name];
    if (!list) return;
    var el = null;
    for (var i = 0; i < list.length; i++) {
        if (list[i].paused || list[i].ended) { el = list[i]; break; }
    }
    if (!el) el = list[0];
    try {
        el.currentTime = 0;
        el.volume = audio.muted ? 0 : audio.volume;
        // 参考对翻页做了音高区分：往回翻 0.93 倍速（更低沉）
        el.playbackRate = (options && options.rate) || 1;
        var playing = el.play();
        if (playing && playing.catch) {
            playing.catch(function (error) {
                // 记下失败原因（自动播放被拦 / 解码失败…）便于排查，不影响翻书
                audio.lastError = (error && error.name) || 'play-rejected';
            });
        }
    } catch (e) { audio.lastError = (e && e.name) || 'play-threw'; }
}

// 首次手势后才建 AudioContext 并解锁（浏览器自动播放策略）
function unlockAudio() {
    if (audio.unlocked) return;
    try {
        ensureAudioPool();
        applyAudioVolume();
        // 预载一次：否则"第一次翻页时 mp3 还没解码完 → 听不到"
        Object.keys(audioPool).forEach(function (name) {
            audioPool[name].forEach(function (el) {
                try { el.load(); } catch (e) { /* 忽略 */ }
            });
        });
        audio.unlocked = true;
    } catch (e) { /* 环境不支持就当静音 */ }
}

function syncAudioUI() {
    if (els.mute) {
        els.mute.setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
        els.mute.setAttribute('aria-label', audio.muted ? '取消静音' : '静音');
        els.mute.title = audio.muted ? '取消静音' : '静音';
        // ⚠️ 别往按钮里写文字：里面是一段 SVG（声波 / 声波加叉靠
        // aria-pressed 切换显隐），textContent 会把整段图标冲掉。
    }
    if (els.volume) {
        els.volume.value = String(audio.volume);
        // 轨道已填充的部分跟着音量走（CSS 里用 --ms-vol 画那道渐变）
        els.volume.style.setProperty('--ms-vol', Math.round(audio.volume * 100) + '%');
    }
    applyAudioVolume();
}

function setMuted(next) {
    audio.muted = !!next;
    if (!audio.muted) unlockAudio();
    audioSavePrefs();
    syncAudioUI();
}

function setVolume(next) {
    audio.volume = Math.max(0, Math.min(1, next));
    audioSavePrefs();
    syncAudioUI();
}

export function bindAudioControls() {
    audioLoadPrefs();
    syncAudioUI();
    if (els.mute) {
        els.mute.addEventListener('click', function (event) {
            event.stopPropagation();
            setMuted(!audio.muted);
        });
    }
    if (els.volume) {
        els.volume.addEventListener('input', function (event) {
            setVolume(parseFloat(event.target.value));
        });
        els.volume.addEventListener('click', function (event) { event.stopPropagation(); });
    }
    // 首次手势解锁：**整页**任意一次按下/按键都算（覆盖层内外都行），
    // 否则从顶栏入口进来、第一次点的是"世界这本书"按钮时就解不了锁。
    document.addEventListener('pointerdown', unlockAudio, true);
    document.addEventListener('keydown', unlockAudio, true);
    // 页面隐藏时把正在响的音效暂停（照参考的 handleVisibility）
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) return;
        Object.keys(audioPool).forEach(function (name) {
            audioPool[name].forEach(function (el) {
                if (!el.paused) {
                    try { el.pause(); } catch (e) { /* 忽略 */ }
                }
            });
        });
    });
}
