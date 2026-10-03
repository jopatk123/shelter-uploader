/**
 * 上传页 UI 冒烟测试（手动脚本，依赖本地已启动的前端与后端）
 *
 * 背景：仓库测试环境为 node，未引入 jsdom / testing-library，
 * 前端组件无法参与 vitest。这里用 CDP 驱动本机 headless Chrome
 * 对上传页的关键 UI 契约做回归，覆盖「容易被后续改动悄悄破坏」的部分：
 *   - 未选点位时上传区是引导式空状态，而不是整块 opacity 半透明
 *   - 限制条件只出现一次（徽标区），不再面板顶部与虚线框各写一整行
 *   - 文件选择器可通过键盘聚焦（sr-only 而非 display:none）
 *   - 素材墙可折叠，且切换点位后恢复展开
 *   - 素材墙图片一行 3 张、视频一行 2 个
 *   - 点阵圆点直径维持可点可讀的 36~48px（写死列数会随屏宽被压小）
 *   - 点位信息与上传区近似 1:1 双栏
 *
 * 用法：
 *   1. 先启动服务（npm run dev 或已常驻的 5173 / 3001）
 *   2. node tests/ui-smoke.mjs
 *   环境变量：BASE_URL（默认 http://localhost:5173）、CHROME_PATH 可覆盖浏览器路径
 */
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9333;
const USER_DATA_DIR = path.join(os.tmpdir(), `uploader-ui-smoke-${process.pid}`);

// 禁用代理，避免本机 localhost 请求被系统代理劫持
process.env.http_proxy = '';
process.env.https_proxy = '';
process.env.no_proxy = 'localhost,127.0.0.1';

function log(...args) {
  console.log('[ui-smoke]', ...args);
}

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function waitForChrome() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {
      // 浏览器尚未就绪，继续等待
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('headless Chrome 启动超时');
}

async function openPage(browserWs) {
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  return { wsUrl: page.webSocketDebuggerUrl, browserWs };
}

async function main() {
  if (!fs.existsSync(CHROME_PATH)) {
    console.error(`[FAIL] 未找到 Chrome：${CHROME_PATH}，可用 CHROME_PATH 环境变量指定`);
    process.exit(1);
  }

  log('启动 headless Chrome...');
  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${USER_DATA_DIR}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let ws;
  try {
    await waitForChrome();
    const { wsUrl } = await openPage();
    ws = new WebSocket(wsUrl);

    let msgId = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    await new Promise((r, j) => {
      ws.addEventListener('open', r);
      ws.addEventListener('error', j);
    });

    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++msgId;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });

    const evalJs = async (expression) => {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (res.result?.exceptionDetails) {
        throw new Error(JSON.stringify(res.result.exceptionDetails));
      }
      return res.result?.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    log(`打开 ${BASE_URL}`);
    await send('Page.navigate', { url: BASE_URL });

    // 等待点位下拉框加载完成（接口返回后才会填充选项）
    for (let i = 0; i < 60; i++) {
      const ready = await evalJs(
        `(() => { const s = document.querySelector('select'); return !!s && s.options.length > 1; })()`,
      );
      if (ready) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    log('— 未选择点位状态 —');
    const idle = await evalJs(`
      (() => {
        const text = document.body.innerText;
        // 面板容器：包含「图片上传」标题的卡片
        const panel = [...document.querySelectorAll('div')].find(
          (d) => d.querySelector('h3') && d.querySelector('h3').textContent.includes('图片上传')
        );
        return {
          hasEmptyState: text.includes('尚未选择点位'),
          hasCta: text.includes('前往选择点位'),
          panelOpacity: panel ? getComputedStyle(panel).opacity : null,
          badgeCount: text.split('JPG / PNG / WEBP').length - 1,
          hasDuplicateHint: (text.match(/自动压缩/g) || []).length,
          // 左侧点位卡与两个上传面板各有空状态，「前往选择点位」只属于上传面板
          ctaCount: (text.match(/前往选择点位/g) || []).length,
        };
      })()
    `);
    check('上传区渲染引导式空状态', idle.hasEmptyState);
    check('空状态提供「前往选择点位」CTA', idle.hasCta);
    check('面板不再整体半透明', idle.panelOpacity === '1', `opacity=${idle.panelOpacity}`);
    check('格式徽标只出现一次', idle.badgeCount === 1, `出现 ${idle.badgeCount} 次`);
    check('限制文案不再重复两处', idle.hasDuplicateHint === 1, `出现 ${idle.hasDuplicateHint} 次`);
    check('图片与视频面板均有 CTA', idle.ctaCount === 2, `检测到 ${idle.ctaCount} 个`);

    log('— CTA 把焦点交还点位选择器 —');
    const ctaFocus = await evalJs(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('前往选择点位'));
        if (!btn) return 'no-cta';
        btn.click();
        return document.activeElement && document.activeElement.tagName;
      })()
    `);
    check('点击 CTA 后焦点落在 select', ctaFocus === 'SELECT', `activeElement=${ctaFocus}`);

    log('— 文件选择器可聚焦（键盘可达）—');
    // 选中一个同时含图片与视频的点位，素材墙的两类网格才都能被断言
    const pickedPoint = await evalJs(`
      (async () => {
        let target = null;
        try {
          const res = await fetch('/api/points');
          const data = await res.json();
          const pts = Array.isArray(data) ? data : data.points || data.data || [];
          target = pts.find((p) => p.img_count > 0 && p.video_count > 0) || null;
        } catch {
          // 接口不可达时退回下拉框第一个点位
        }
        const sel = document.querySelector('select');
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, target ? String(target.id) : sel.options[1].value);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return target ? target.id : Number(sel.value);
      })()
    `);
    log(`已选中点位 #${pickedPoint}`);
    await new Promise((r) => setTimeout(r, 1500));

    const selected = await evalJs(`
      (() => {
        const input = document.getElementById('image-input');
        if (!input) return null;
        const style = getComputedStyle(input);
        // sr-only：参与可访问性树且可被聚焦，但视觉尺寸被裁剪到 1×1
        const rect = input.getBoundingClientRect();
        input.focus();
        return {
          display: style.display,
          focused: document.activeElement === input,
          hiddenSize: rect.width <= 1 && rect.height <= 1,
          text: document.body.innerText.includes('拖拽到此处'),
        };
      })()
    `);
    check('选择点位后出现文件输入', selected !== null);
    check('文件输入可被键盘聚焦', selected?.focused === true);
    check(
      '文件输入视觉隐藏但仍存在',
      selected?.display !== 'none' && selected?.hiddenSize === true,
    );
    check('选择区展示拖放入口文案', selected?.text === true);

    log('— 双栏布局宽度接近 1:1 —');
    const layout = await evalJs(`
      (() => {
        const grid = [...document.querySelectorAll('main > div')].find((d) =>
          d.className.includes('lg:grid-cols-2')
        );
        if (!grid || grid.children.length < 2) return null;
        const [left, right] = grid.children;
        const lw = left.getBoundingClientRect().width;
        const rw = right.getBoundingClientRect().width;
        return { left: Math.round(lw), right: Math.round(rw), ratio: +(lw / rw).toFixed(3) };
      })()
    `);
    check(
      '左右两栏宽度比值在 0.9~1.1 之间',
      !!layout && layout.ratio >= 0.9 && layout.ratio <= 1.1,
      JSON.stringify(layout),
    );

    log('— 素材墙网格列数：图片 3 / 视频 2 —');
    // 素材列表是异步加载的，等到缩略图真正进 DOM 再断言，避免偶发的空窗期
    for (let i = 0; i < 40; i++) {
      const ready = await evalJs(`
        (() => {
          const b = document.getElementById('material-wall-body');
          return !!b && b.querySelectorAll('img').length > 0 && b.querySelectorAll('video').length > 0;
        })()
      `);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const wallGrids = await evalJs(`
      (() => {
        const body = document.getElementById('material-wall-body');
        if (!body) return null;
        const colsOf = (el) =>
          el ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length : null;
        const img = body.querySelector('img');
        const video = body.querySelector('video');
        return {
          imgCols: img ? colsOf(img.closest('div.grid')) : null,
          videoCols: video ? colsOf(video.closest('div.grid')) : null,
        };
      })()
    `);
    check('已上传图片一行 3 张', wallGrids?.imgCols === 3, JSON.stringify(wallGrids));
    check('已上传视频一行 2 个', wallGrids?.videoCols === 2, JSON.stringify(wallGrids));

    log('— 点阵圆点尺寸 —');
    const dotGrid = await evalJs(`
      (() => {
        const grid = document.querySelector('.point-dot-grid');
        if (!grid) return null;
        // 取最后一个圆点：它不会被选中态/高亮态的 scale 放大，量到的是原始直径
        const dot = grid.lastElementChild?.firstElementChild;
        if (!dot) return null;
        const rect = dot.getBoundingClientRect();
        const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
        return {
          diameter: Math.round(rect.width * 10) / 10,
          cols,
          rows: Math.ceil(grid.children.length / cols),
          count: grid.children.length,
        };
      })()
    `);
    // 原 47 列布局在 1440 下圆点仅约 23px，放大 1.5 倍后应落在 34~48px
    check(
      '圆点直径放大到 34~48px',
      !!dotGrid && dotGrid.diameter >= 34 && dotGrid.diameter <= 48,
      JSON.stringify(dotGrid),
    );
    check('141 个点位全部渲染', dotGrid?.count === 141, JSON.stringify(dotGrid));

    log('— 素材墙可折叠 —');
    const wallBefore = await evalJs(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-controls') === 'material-wall-body');
        if (!btn) return null;
        const body = document.getElementById('material-wall-body');
        return { expanded: btn.getAttribute('aria-expanded'), bodyVisible: !!body };
      })()
    `);
    check('素材墙默认展开', wallBefore?.expanded === 'true' && wallBefore?.bodyVisible === true);

    const wallAfter = await evalJs(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-controls') === 'material-wall-body');
        btn.click();
        const body = document.getElementById('material-wall-body');
        return { expanded: btn.getAttribute('aria-expanded'), bodyVisible: !!body };
      })()
    `);
    // React 状态更新后需等一帧
    await new Promise((r) => setTimeout(r, 300));
    const wallSettled = await evalJs(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-controls') === 'material-wall-body');
        return {
          expanded: btn.getAttribute('aria-expanded'),
          bodyVisible: !!document.getElementById('material-wall-body'),
        };
      })()
    `);
    check(
      '点击标题可折叠素材墙',
      wallAfter !== null && wallSettled.expanded === 'false' && wallSettled.bodyVisible === false,
      JSON.stringify(wallSettled),
    );

    log('— 顶栏不再与点阵区重复进度百分比 —');
    const header = await evalJs(`
      (() => {
        const h = document.querySelector('header');
        return { hasPercent: /\\d+%/.test(h.innerText), hasCount: /\\d+ 个点位/.test(h.innerText) };
      })()
    `);
    check('顶栏不再显示百分比', header.hasPercent === false);
    check('顶栏仍显示点位总数', header.hasCount === true);

    await send('Page.captureScreenshot', { format: 'png' });
  } finally {
    ws?.close();
    chrome.kill();
    // 等浏览器进程真正退出，否则 profile 目录仍有文件被占用，rmSync 会抛 ENOTEMPTY
    await new Promise((r) => setTimeout(r, 1000));
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch {
      // 临时 profile 残留不影响断言结论
    }
  }

  if (failed > 0) {
    console.error(`\n[FAIL] ${failed} 项断言未通过`);
    process.exit(1);
  }
  console.log('\n[ui-smoke] 全部断言通过');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
