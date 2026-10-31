/**
 * 文本与日期格式化。
 *
 * 时间线日期统一按北京时间展示；escapeHtml 用于所有拼进 innerHTML 的用户数据。
 */

// 格式化为 yyyy-mm-dd
export function formatDateToYMD(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    } catch {
        return dateString;
    }
}

// 时间线使用分层日期标记，统一按北京时间展示，避免浏览器时区造成日期跳变。
export function getTimelineDateParts(dateString) {
    const fallback = {
        year: '',
        monthDay: formatDateToYMD(dateString).replace(/-/g, '.'),
        weekday: ''
    };

    if (!dateString) return fallback;

    try {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return fallback;

        const parts = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short'
        }).formatToParts(date);
        const valueOf = (type) => parts.find(part => part.type === type)?.value || '';

        return {
            year: valueOf('year'),
            monthDay: `${valueOf('month')}.${valueOf('day')}`,
            weekday: valueOf('weekday')
        };
    } catch (error) {
        console.warn('时间线日期解析失败:', error);
        return fallback;
    }
}

export function escapeHtml(unsafe = '') {
    return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}
