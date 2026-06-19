/**
 * AI学习网 - 视频抓取引擎
 * 支持从 B站 / YouTube 等平台自动抓取博主视频
 */
const axios = require('axios');
const { query, run } = require('./database');

// ---- 平台识别 ----
function detectPlatform(url) {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('xiaohongshu.com')) return 'xiaohongshu';
  if (u.includes('douyin.com')) return 'douyin';
  if (u.includes('ixigua.com')) return 'xigua';
  if (u.includes('huoshan.com')) return 'huoshan';
  if (u.includes('kuaishou.com')) return 'kuaishou';
  if (u.includes('weibo.com')) return 'weibo';
  if (u.includes('zhihu.com')) return 'zhihu';
  if (u.includes('x.com') || u.includes('twitter.com')) return 'twitter';
  return 'other';
}

// ---- 从 URL 提取用户标识 ----
function extractUserId(url, platform) {
  switch (platform) {
    case 'bilibili': {
      const m = url.match(/(?:space\.bilibili\.com|b23\.tv)\/(\d+)/i);
      return m ? m[1] : null;
    }
    case 'youtube': {
      let m = url.match(/youtube\.com\/@([\w-]+)/i);
      if (m) return '@' + m[1];
      m = url.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
      if (m) return m[1];
      m = url.match(/youtube\.com\/c\/([\w-]+)/i);
      if (m) return 'c/' + m[1];
      return null;
    }
    case 'xiaohongshu': {
      // https://www.xiaohongshu.com/user/profile/5f0a1a2b0000000001003b0a
      // 或 https://www.xiaohongshu.com/user/profile/用户ID
      let m = url.match(/xiaohongshu\.com\/user\/profile\/([\w]+)/i);
      if (m) return m[1];
      m = url.match(/xiaohongshu\.com\/user\/([\w]+)/i);
      return m ? m[1] : null;
    }
    case 'douyin': {
      const m = url.match(/douyin\.com\/user\/([\w]+)/i);
      return m ? m[1] : null;
    }
    default:
      return null;
  }
}

// ---- 从 URL 提取博主名称（降级方案） ----
function extractNameFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '').split('.')[0];
    return host.charAt(0).toUpperCase() + host.slice(1);
  } catch {
    return '未知博主';
  }
}

// ---- B站 WBI 签名（B站API需要） ----
const md5 = require('md5');
const MIXIN_KEY_ENC_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 37, 12, 52, 56, 7,
  0, 57, 39, 21, 59, 40, 30, 44, 55, 38, 11, 54, 24, 16, 20, 51,
  26, 60, 48, 1, 36, 6, 25, 13, 22, 41, 4, 34, 17, 61
];

let wbiKeysCache = { keys: null, expires: 0 };

async function getWbiKeys() {
  if (wbiKeysCache.keys && Date.now() < wbiKeysCache.expires) return wbiKeysCache.keys;
  try {
    const res = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com/'
      },
      timeout: 8000
    });
    const data = res.data;
    if (data.code !== 0 || !data.data?.wbi_img) throw new Error('无法获取WBI密钥');

    const imgUrl = data.data.wbi_img.img_url;
    const subUrl = data.data.wbi_img.sub_url;
    const imgKey = imgUrl.substring(imgUrl.lastIndexOf('/') + 1, imgUrl.lastIndexOf('.'));
    const subKey = subUrl.substring(subUrl.lastIndexOf('/') + 1, subUrl.lastIndexOf('.'));
    const keys = { imgKey, subKey };
    wbiKeysCache = { keys, expires: Date.now() + 3600000 }; // 缓存1小时
    return keys;
  } catch (err) {
    // 如果获取失败，使用缓存或返回 null
    return wbiKeysCache.keys || null;
  }
}

function encryptWbi(params, keys) {
  if (!keys) return null;
  const mixinKey = MIXIN_KEY_ENC_TABLE.map(i => (keys.imgKey + keys.subKey)[i]).join('').slice(0, 32);
  const sortedKeys = Object.keys(params).sort();
  const query = sortedKeys.map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const sign = md5(query + mixinKey);
  return { wts: Math.floor(Date.now() / 1000), w_rid: sign };
}

// ---- B站空间视频抓取（支持 WBI 签名） ----
async function fetchBilibiliVideos(uid) {
  const videos = [];
  let page = 1;
  let hasMore = true;

  // 获取 WBI keys
  const wbiKeys = await getWbiKeys();

  while (hasMore && page <= 10) {
    try {
      const params = { mid: uid, ps: 30, pn: page };
      const signed = encryptWbi(params, wbiKeys);
      const queryParams = { ...params };
      if (signed) {
        queryParams.wts = signed.wts;
        queryParams.w_rid = signed.w_rid;
      }

      const res = await axios.get(`https://api.bilibili.com/x/space/wbi/arc/search`, {
        params: queryParams,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://space.bilibili.com/' + uid
        },
        timeout: 10000
      });

      const data = res.data;
      if (data.code !== 0 || !data.data?.list?.videos) {
        if (data.code === -412 || data.code === 412) {
          console.log('[Scraper] B站请求被拦截(code=412)，尝试降级...');
          // 降级：用旧API或直接返回已有结果
          if (videos.length > 0) break;
          // 尝试备用接口
          const backupRes = await axios.get(`https://api.bilibili.com/x/space/arc/search`, {
            params: { mid: uid, ps: 30, pn: page, order: 'pubdate' },
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://space.bilibili.com/' + uid
            },
            timeout: 10000
          });
          const backupData = backupRes.data;
          if (backupData.code === 0 && backupData.data?.list?.videos) {
            const memberName = backupData.data.member?.name || '';
            for (const v of backupData.data.list.videos) {
              videos.push({
                title: v.title || v.name || '',
                url: v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : (v.aid ? `https://www.bilibili.com/video/av${v.aid}` : ''),
                embed_code: v.bvid ? `<iframe src="//player.bilibili.com/player.html?bvid=${v.bvid}" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>` : '',
                platform: 'B站',
                description: v.description || '',
                thumbnail: v.pic || '',
                duration: formatDuration(v.duration || v.length || 0),
                tags: v.tname || '',
                source_author: memberName,
                views: v.play || v.stat?.view || 0,
              });
            }
            hasMore = backupData.data.list.videos.length >= 30;
            page++;
            continue;
          }
        }
        break;
      }

      const list = data.data.list.videos;
      const memberName = data.data?.member?.name || '';

      for (const v of list) {
        videos.push({
          title: v.title,
          url: `https://www.bilibili.com/video/${v.bvid}`,
          embed_code: `<iframe src="//player.bilibili.com/player.html?bvid=${v.bvid}" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`,
          platform: 'B站',
          description: v.description || '',
          thumbnail: `https://i0.hdslb.com/bfs/archive/${v.pic?.replace(/^.*\//, '') || ''}`,
          duration: formatDuration(v.duration),
          tags: v.tid ? [v.tname].filter(Boolean).join(',') : '',
          source_author: memberName,
          views: v.play || 0,
        });
      }

      hasMore = list.length >= 30;
      page++;
    } catch (err) {
      console.error('[Scraper] B站抓取失败:', err.message);
      // 不直接 break，尝试下一页
      page++;
      if (page > 3) break;
    }
  }

  // 如果API没抓到数据，降级到 Puppeteer 浏览器抓取
  if (videos.length === 0) {
    console.log('[Scraper] B站 API 无数据，降级到浏览器抓取...');
    try {
      const { fetchBilibiliVideos: browserFetch } = require('./browser-scraper');
      const browserResult = await browserFetch(uid);
      if (browserResult.videos.length > 0) {
        videos.push(...browserResult.videos);
      }
    } catch (browserErr) {
      console.log('[Scraper] B站浏览器抓取也失败:', browserErr.message);
    }
  }

  return videos;
}

// ---- YouTube 视频抓取（通过 RSS） ----
async function fetchYouTubeVideos(channelHandle) {
  const videos = [];

  try {
    // 尝试通过 RSS feed 抓取
    let channelId = channelHandle;

    // 如果是 @handle 格式，先获取 channel ID
    if (channelHandle.startsWith('@')) {
      try {
        const res = await axios.get(`https://www.youtube.com/${channelHandle}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 8000,
          maxRedirects: 5
        });
        // 从页面提取 channel_id
        const match = res.data.match(/(?:channel_id|externalId)["']?\s*[:=]\s*["'](UC[\w-]{22})["']/i);
        if (match) channelId = match[1];
      } catch { /* fallback */ }
    }

    // 通过 RSS feed
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const res = await axios.get(feedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    // 解析 XML
    const xml = res.data;
    const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
    let entryMatch;

    while ((entryMatch = entryPattern.exec(xml)) !== null) {
      const entry = entryMatch[1];
      const title = entry.match(/<title>(.*?)<\/title>/)?.[1] || '';
      const videoId = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1] || '';
      const author = entry.match(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/)?.[1] || '';
      const published = entry.match(/<published>(.*?)<\/published>/)?.[1] || '';

      if (videoId) {
        videos.push({
          title: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
          url: `https://www.youtube.com/watch?v=${videoId}`,
          embed_code: `<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`,
          platform: 'YouTube',
          description: '',
          thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          duration: '',
          tags: '',
          source_author: author,
          views: 0,
        });
      }
    }
  } catch (err) {
    console.error('[Scraper] YouTube抓取失败:', err.message);
  }

  return videos;
}

// ---- 小红书视频抓取（尽力而为） ----
async function fetchXiaohongshuVideos(userId) {
  const videos = [];
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const headers = {
    'User-Agent': ua,
    'Referer': 'https://www.xiaohongshu.com/',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
  };

  try {
    console.log(`[Scraper] 尝试抓取小红书: ${userId}`);

    // 方法1: 尝试 API 端点 (edith.xiaohongshu.com)
    try {
      const apiRes = await axios.get(
        `https://edith.xiaohongshu.com/api/sns/web/v1/user/otherinfo`,
        {
          params: { user_id: userId },
          headers: {
            ...headers,
            'Origin': 'https://www.xiaohongshu.com',
            'X-Requested-With': 'XMLHttpRequest',
          },
          timeout: 8000
        }
      );
      if (apiRes.data?.success) {
        const userData = apiRes.data.data || {};
        const notes = userData.notes || userData.userNoteList || [];
        for (const n of notes) {
          const note = n.note || n;
          const title = note.displayTitle || note.title || note.desc || '';
          const noteId = note.noteId || note.id || '';
          const cover = note.cover?.urlList?.[0] || note.cover?.url || note.cover?.imageUrl || '';
          if (title && noteId) {
            videos.push({
              title: title.replace(/<[^>]*>/g, '').trim(),
              url: `https://www.xiaohongshu.com/explore/${noteId}`,
              embed_code: `<a href="https://www.xiaohongshu.com/explore/${noteId}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#fe2c55;color:#fff;border-radius:8px;text-decoration:none">📕 在小红书查看</a>`,
              platform: '小红书',
              description: title,
              thumbnail: cover,
              duration: '', tags: '',
              source_author: userData.nickname || userData.nickName || '',
              views: note.likedCount || 0,
            });
          }
        }
      }
    } catch { /* API 方法失败, 继续尝试其他方法 */ }

    // 方法2: 尝试抓取网页版
    if (videos.length === 0) {
      try {
        const res = await axios.get(`https://www.xiaohongshu.com/user/profile/${userId}`, {
          headers: { ...headers, 'Accept': 'text/html,*/*' },
          timeout: 10000
        });
        const html = res.data;

        // 尝试提取 __INITIAL_STATE__
        const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/s);
        if (stateMatch) {
          try {
            const data = JSON.parse(stateMatch[1]);
            const notes = data?.user?.userNoteList?.notes || data?.userNoteList?.notes || data?.notes || [];
            for (const n of notes) {
              const title = n.displayTitle || n.title || n.desc || '';
              const noteId = n.noteId || n.id || '';
              const cover = n.cover?.url || n.cover?.imageUrl || n.cover?.defaultUrl || '';
              const author = n.user?.nickname || n.nickName || '';
              if (title && noteId) {
                videos.push({
                  title: title.replace(/<[^>]*>/g, '').trim(),
                  url: `https://www.xiaohongshu.com/explore/${noteId}`,
                  embed_code: `<a href="https://www.xiaohongshu.com/explore/${noteId}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#fe2c55;color:#fff;border-radius:8px;text-decoration:none">📕 在小红书查看</a>`,
                  platform: '小红书', description: title,
                  thumbnail: cover, duration: '', tags: '',
                  source_author: author, views: n.likedCount || 0,
                });
              }
            }
          } catch {}
        }
      } catch {}
    }

    if (videos.length === 0) {
      console.log(`[Scraper] 小红书 axios 未抓到数据，尝试浏览器渲染抓取...`);
      try {
        const { fetchXiaohongshuVideos: browserFetch } = require('./browser-scraper');
        const browserResult = await browserFetch(userId);
        if (browserResult.videos.length > 0) {
          videos.push(...browserResult.videos);
        }
      } catch (browserErr) {
        console.log(`[Scraper] 浏览器抓取也无数据: ${browserErr.message}`);
      }
    }

    if (videos.length > 0) {
      console.log(`[Scraper] 小红书成功: ${videos.length} 条`);
    } else {
      console.log(`[Scraper] 小红书最终无数据（平台反爬严格）`);
    }
    return videos;

  } catch (err) {
    console.error(`[Scraper] 小红书抓取失败:`, err.message);
    return videos;
  }
}

// ---- 通用时长格式化 ----
function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '';
  const s = parseInt(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ---- 主入口：根据 URL 抓取视频 ----
async function fetchVideosFromUrl(url) {
  const platform = detectPlatform(url);
  const userId = extractUserId(url, platform);

  if (!userId) {
    return {
      success: false,
      platform,
      message: `无法从URL中识别${platform ? getPlatformName(platform) : ''}用户ID，请检查链接是否正确`,
      videos: []
    };
  }

  let videos = [];
  let bloggerName = '';

  switch (platform) {
    case 'bilibili': {
      videos = await fetchBilibiliVideos(userId);
      if (videos.length > 0) {
        bloggerName = videos[0].source_author || 'B站用户';
      }
      break;
    }
    case 'youtube': {
      videos = await fetchYouTubeVideos(userId);
      if (videos.length > 0) {
        bloggerName = videos[0].source_author || 'YouTube创作者';
      }
      break;
    }
    case 'xiaohongshu': {
      videos = await fetchXiaohongshuVideos(userId);
      if (videos.length > 0) {
        bloggerName = videos[0].source_author || '小红书博主';
      }
      break;
    }
    default: {
      return {
        success: false,
        platform,
        message: `暂不支持 ${getPlatformName(platform)} 的自动抓取（目前支持 B站、YouTube、小红书），请手动添加视频`,
        videos: []
      };
    }
  }

  return {
    success: true,
    platform,
    bloggerName,
    userId,
    videos,
    message: `成功抓取 ${videos.length} 个视频`
  };
}

function getPlatformName(platform) {
  const names = {
    bilibili: 'B站',
    youtube: 'YouTube',
    xiaohongshu: '小红书',
    douyin: '抖音',
    xigua: '西瓜视频',
    kuaishou: '快手',
    weibo: '微博',
    zhihu: '知乎',
    twitter: 'X/Twitter',
    other: '其他'
  };
  return names[platform] || platform;
}

// ---- 批量保存抓取的视频到数据库 ----
function saveFetchedVideos(bloggerId, videos, categoryId, aiModelId) {
  const { classifyVideo } = require('./classifier');
  let saved = 0;
  for (const v of videos) {
    // 检查是否已存在
    const exists = query(`SELECT id FROM videos WHERE url = ? AND blogger_id = ?`, [v.url, bloggerId]);
    if (exists.length > 0) continue;

    // 自动分类：未指定分类/模型时，从标题智能识别
    const finalCatId = categoryId || v.category_id || null;
    const finalModelId = aiModelId || v.ai_model_id || null;
    const auto = classifyVideo(v.title, v.description || '');
    const catId = finalCatId || auto.categoryId || null;
    const modelId = finalModelId || auto.modelId || null;

    run(`INSERT INTO videos (title, description, url, embed_code, platform, category_id, ai_model_id,
      tags, thumbnail, duration, source_author, blogger_id, views, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`,
      [v.title, v.description, v.url, v.embed_code, v.platform,
       catId, modelId,
       v.tags, v.thumbnail, v.duration, v.source_author, bloggerId, v.views || 0]);
    saved++;
  }

  // 更新博主视频数
  run(`UPDATE bloggers SET video_count = (SELECT COUNT(*) FROM videos WHERE blogger_id = ?), last_sync_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [bloggerId, bloggerId]);

  return saved;
}

module.exports = {
  detectPlatform,
  extractUserId,
  fetchVideosFromUrl,
  fetchXiaohongshuVideos,
  saveFetchedVideos,
  getPlatformName
};
