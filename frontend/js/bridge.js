// 桥接层：优先使用 TauriCPP 注入的原生桥；
// 浏览器开发/测试环境自动降级为 mock（localStorage 存取 + 下载导出）。
(function () {
    'use strict';

    // 惰性获取原生桥（注入时序安全）
    function api() {
        return (window.__tauricpp__ && window.__tauricpp__.invoke) ? window.__tauricpp__ : null;
    }

    // 全局错误上报（原生环境下写入日志文件）
    window.addEventListener('error', e => {
        const a = api();
        if (!a) return;
        const msg = (e && e.message ? e.message : String(e)) +
            (e && e.error && e.error.stack ? '\n' + e.error.stack : '');
        try { a.invoke('log_error', { message: msg }); } catch (_) { /* ignore */ }
    });

    async function mockInvoke(cmd, args) {
        switch (cmd) {
            case 'open_project': {
                const raw = localStorage.getItem('stepdraw.doc');
                if (!raw) return { ok: false, reason: 'cancel' };
                return { ok: true, path: '浏览器草稿.stepdraw', content: raw };
            }
            case 'save_project':
                localStorage.setItem('stepdraw.doc', args.content || '');
                return { ok: true };
            case 'save_project_as':
                localStorage.setItem('stepdraw.doc', args.content || '');
                return { ok: true, path: '浏览器草稿.stepdraw' };
            case 'export_png': {
                const a = document.createElement('a');
                a.href = 'data:image/png;base64,' + (args.data || '');
                a.download = args.default_name || 'stepdraw.png';
                a.click();
                return { ok: true, path: args.default_name || '' };
            }
            case 'set_title':
                document.title = args.title || 'StepDraw';
                return { success: true };
            case 'log_error':
                console.error('[stepdraw]', args.message || '');
                return { success: true };
            default:
                return { ok: false, reason: 'unknown_cmd: ' + cmd };
        }
    }

    async function invoke(cmd, args) {
        try {
            const a = api();
            if (a) return await a.invoke(cmd, args || {});
            return await mockInvoke(cmd, args || {});
        } catch (err) {
            console.error('[bridge]', cmd, err);
            return { ok: false, reason: String(err) };
        }
    }

    window.Bridge = { invoke, get isNative() { return !!api(); } };
})();
