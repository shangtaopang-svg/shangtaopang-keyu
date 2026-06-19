/**
 * AI学习网 - 浏览器自动化抓取模块
 * 使用 Puppeteer 处理需要 JavaScript 渲染的网站（小红书等）
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

let browser = null;
let browserWSEndpoint = null;

// ---- 获取浏览器实例（复用同一实例） ----
// Chrome 路径（优先使用系统安装的 Chrome）
const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

function findChrome() {
  const fs = require('fs');
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  try {
    const chromePath = process.env.CHROME_PATH || findChrome();
    const opts = {
      headless: true,
      args: [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
      ],
    };
    if (chromePath) {
      opts.executablePath = chromePath;
      console.log(`[Browser] 使用系统 Chrome: ${chromePath}`);
    }
    browser = await puppeteer.launch(opts);
    browserWSEndpoint = browser.wsEndpoint();
    console.log('[Browser] Puppeteer 浏览器已启动');
    return browser;
  } catch (err) {
    console.error('[Browser] 启动失败:', err.message);
    throw err;
  }
}

// ---- 关闭浏览器 ----
async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
    browserWSEndpoint = null;
    console.log('[Browser] 浏览器已关闭');
  }
}

// ---- 通用延迟 ----
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- 小红书 - 浏览器抓取 ----
async function fetchXiaohongshuVideos(userId) {
  const videos = [];
  let page = null;

  try {
    const br = await getBrowser();
    page = await br.newPage();

    // 拦截网络请求以捕获API数据
    const apiResponses = [];
    await page.setRequestInterception(true);

    page.on('request', (req) => {
      const url = req.url();
      // 允许关键请求，阻止不必要的资源
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('api/sns/web/v1/user/otherinfo') ||
          url.includes('api/sns/web/v1/feed') ||
          url.includes('userNoteList')) {
        try {
          const json = await res.json();
          apiResponses.push(json);
        } catch {}
      }
    });

    // 设置浏览器指纹
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    });

    console.log(`[Browser] 小红书: 打开用户主页 ${userId}`);
    await page.goto(`https://www.xiaohongshu.com/user/profile/${userId}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // 等待页面渲染
    await sleep(3000);

    // 方法1: 从拦截的 API 响应中提取数据
    for (const data of apiResponses) {
      const notes = data?.data?.notes || data?.data?.userNoteList || data?.items || [];
      if (notes.length > 0) {
        for (const item of notes) {
          const note = item.note || item;
          const title = note.displayTitle || note.title || note.desc || '';
          const noteId = note.noteId || note.id || '';
          const cover = note.cover?.urlList?.[0] || note.cover?.url || note.cover?.imageUrl || note.imageList?.[1]?.url || '';
          const author = note.user?.nickname || note.nickName || '';
          if (title && noteId) {
            videos.push({
              title: title.replace(/<[^>]*>/g, '').trim(),
              url: `https://www.xiaohongshu.com/explore/${noteId}`,
              embed_code: `<a href="https://www.xiaohongshu.com/explore/${noteId}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#fe2c55;color:#fff;border-radius:8px;text-decoration:none">📕 在小红书查看</a>`,
              platform: '小红书',
              description: title,
              thumbnail: cover,
              duration: '',
              tags: '',
              source_author: author,
              views: note.likedCount || 0,
            });
          }
        }
        if (videos.length > 0) break;
      }
    }

    // 方法2: 从 DOM 中提取
    if (videos.length === 0) {
      console.log('[Browser] 小红书: API拦截未获数据，尝试DOM提取');
      const domData = await page.evaluate(() => {
        // 尝试找 __INITIAL_STATE__
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
          const text = s.textContent || '';
          if (text.includes('__INITIAL_STATE__')) {
            const m = text.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/s);
            if (m) return m[1];
          }
          if (text.includes('__NUXT__')) {
            const m = text.match(/window\.__NUXT__\s*=\s*({.*?});/s);
            if (m) return m[1];
          }
        }
        // 尝试找笔记卡片
        const items = document.querySelectorAll('[class*="note-item"], [class*="feeds-page"] a, section a');
        const notes = [];
        items.forEach(el => {
          const link = el.closest('a') || el;
          const href = link.href || '';
          const title = link.querySelector('[class*="title"], [class*="Title"], img[alt]')?.getAttribute('alt')
            || link.textContent?.trim()?.slice(0, 50) || '';
          const img = link.querySelector('img')?.src || '';
          if (href.includes('/explore/')) {
            notes.push({ href, title, img });
          }
        });
        return JSON.stringify({ notes });
      });

      try {
        const parsed = JSON.parse(domData);
        if (parsed.notes) {
          for (const item of parsed.notes) {
            const noteId = item.href?.match(/\/explore\/([\w\d]+)/)?.[1];
            if (noteId) {
              videos.push({
                title: item.title || '小红书笔记',
                url: `https://www.xiaohongshu.com/explore/${noteId}`,
                embed_code: `<a href="https://www.xiaohongshu.com/explore/${noteId}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#fe2c55;color:#fff;border-radius:8px;text-decoration:none">📕 在小红书查看</a>`,
                platform: '小红书',
                description: item.title,
                thumbnail: item.img || '',
                duration: '', tags: '',
                source_author: '',
                views: 0,
              });
            }
          }
        }
      } catch {}
    }

    // 获取博主名称
    let bloggerName = '';
    try {
      bloggerName = await page.evaluate(() => {
        const nameEl = document.querySelector('[class*="username"], [class*="UserName"], [class*="nickname"]');
        return nameEl?.textContent?.trim() || '';
      });
    } catch {}

    console.log(`[Browser] 小红书结果: ${videos.length} 条笔记`);
    return { videos, bloggerName };

  } catch (err) {
    console.error(`[Browser] 小红书抓取失败:`, err.message);
    return { videos: [], bloggerName: '' };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ---- B站 - 浏览器抓取（API风控时的降级方案） ----
async function fetchBilibiliVideos(uid) {
  const videos = [];
  let page = null;

  try {
    const br = await getBrowser();
    page = await br.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`[Browser] B站: 打开空间 ${uid}`);
    await page.goto(`https://space.bilibili.com/${uid}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // 等待页面渲染
    await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));

    // 先获取博主名称
    let bloggerName = '';
    try {
      bloggerName = await page.evaluate(() => {
        const el = document.querySelector('.h-name, .user-name, [class*="userName"], .user-name');
        if (el?.textContent?.trim()) return el.textContent.trim();
        const m = document.title.match(/^(.+?)的个人空间/);
        return m ? m[1] : '';
      });
    } catch {}
    console.log(`[Browser] B站博主: ${bloggerName || '未知'}`);

    // 方法：直接点击"投稿" tab 加载全部视频
    try {
      const hasVideoTab = await page.evaluate(() => {
        const tabs = document.querySelectorAll('[class*="tab"], [class*="menu-item"], nav a, .section-title');
        for (const t of tabs) {
          if (t.textContent.includes('投稿') || t.textContent.includes('视频')) {
            t.click();
            return true;
          }
        }
        return false;
      });
      if (hasVideoTab) {
        await page.evaluate(() => new Promise(r => setTimeout(r, 3000)));
      }
    } catch {}

    // 从 DOM 提取视频列表（滚动加载更多）
    let prevCount = 0;
    for (let scroll = 0; scroll < 3; scroll++) {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        return new Promise(r => setTimeout(r, 2000));
      });

      const newVideos = await page.evaluate(() => {
        const results = [];
        // 找所有包含 BVID 的链接
        const links = document.querySelectorAll('a[href*="video/BV"]');
        const seen = new Set();
        links.forEach(a => {
          const href = a.href;
          const bvid = href.match(/video\/(BV[\w]+)/)?.[1];
          if (bvid && !seen.has(bvid)) {
            seen.add(bvid);
            // 找附近标题
            const titleEl = a.querySelector('[class*="title"], img[alt]');
            const title = titleEl?.textContent?.trim()
              || titleEl?.getAttribute('alt')?.trim()
              || a.title?.trim() || '';
            const img = a.querySelector('img')?.src || '';
            results.push({ bvid, title, img, href });
          }
        });
        return results;
      });

      for (const v of newVideos) {
        if (!videos.some(x => x.url.includes(v.bvid))) {
          videos.push({
            title: v.title || 'B站视频',
            url: `https://www.bilibili.com/video/${v.bvid}`,
            embed_code: `<iframe src="//player.bilibili.com/player.html?bvid=${v.bvid}" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`,
            platform: 'B站', description: '', thumbnail: v.img || '',
            duration: '', tags: '', source_author: bloggerName, views: 0,
          });
        }
      }

      if (videos.length === prevCount && scroll > 0) break;
      prevCount = videos.length;
    }

    console.log(`[Browser] B站结果: ${videos.length} 条视频`);
    return { videos, bloggerName };

  } catch (err) {
    console.error(`[Browser] B站抓取失败:`, err.message);
    return { videos: [], bloggerName: '' };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

function formatDurationB(seconds) {
  if (!seconds && seconds !== 0) return '';
  const s = parseInt(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

module.exports = {
  fetchXiaohongshuVideos,
  fetchBilibiliVideos,
  closeBrowser,
};
