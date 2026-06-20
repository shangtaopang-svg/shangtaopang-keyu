const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { initDatabase, query, get, run, saveDatabase } = require('./database');
const { fetchVideosFromUrl, saveFetchedVideos, detectPlatform, getPlatformName } = require('./scraper');
const { generateFullAnalysis } = require('./analyzer');
const { classifyVideo } = require('./classifier');

// ---- 内存缓存 (TTL 30秒，读写操作时自动失效) ----
const cache = { _data: {}, _timers: {} };
function cacheGet(key) {
  const entry = cache._data[key];
  if (!entry) return null;
  if (Date.now() > entry.expires) { delete cache._data[key]; return null; }
  return entry.value;
}
function cacheSet(key, value, ttl = 30000) {
  cache._data[key] = { value, expires: Date.now() + ttl };
  if (cache._timers[key]) clearTimeout(cache._timers[key]);
}
function cacheClear() { cache._data = {}; }

// 带缓存的查询（适用不常变的数据，缓存30秒）
function cachedQuery(sql, params = []) {
  const key = sql + '|' + JSON.stringify(params);
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  const result = query(sql, params);
  cacheSet(key, result);
  return result;
}

const app = express();
const PORT = process.env.PORT || 3000;

// ---- JWT密钥：优先使用环境变量 ----
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('⚠️  警告: JWT_SECRET 环境变量未设置，使用不安全的默认密钥！');
  console.warn('    生产环境请设置: set JWT_SECRET=your-secure-secret-here');
  JWT_SECRET = 'dev-secret-do-not-use-in-production';
}

// ---- 安全中间件 ----
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // 该站点用了内联样式等，暂时关闭CSP
}));

// ---- 登录频率限制 ----
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 10,                   // 最多10次尝试
  message: { error: '登录尝试过多，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ---- gzip 压缩 ----
app.use(compression());

// ---- 请求日志 ----
app.use(morgan('dev'));

// ---- 标准中间件 ----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  immutable: true,
  setHeaders: (res, path) => {
    if (path.match(/\/thumbs\//)) res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

// 设置 EJS 模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  }
});

// ---- Auth 中间件 ----
function authMiddleware(req, res, next) {
  // 管理后台写操作后清除页面缓存
  if (['POST','PUT','DELETE','PATCH'].includes(req.method)) cacheClear();
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) {
    // API 请求返回 JSON，页面请求重定向到登录页
    if (req.xhr || req.path.startsWith('/api/') || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: '未登录' });
    }
    return res.redirect('/admin/login');
  }
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    if (req.xhr || req.path.startsWith('/api/') || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: '登录已过期' });
    }
    return res.redirect('/admin/login');
  }
}

// ---- 前端页面路由 ----

// 首页
app.get('/', (req, res) => {
  // 首页数据缓存30秒
  const featured = cachedQuery(`SELECT v.*, c.name as category_name, c.slug as category_slug,
    c.icon as category_icon, m.name as model_name, m.slug as model_slug, m.icon as model_icon,
    b.name as blogger_name, b.slug as blogger_slug
    FROM videos v
    LEFT JOIN categories c ON v.category_id = c.id
    LEFT JOIN ai_models m ON v.ai_model_id = m.id
    LEFT JOIN bloggers b ON v.blogger_id = b.id
    WHERE v.featured = 1 AND v.status = 'published'
    ORDER BY v.created_at DESC LIMIT 6`);

  const latest = cachedQuery(`SELECT v.*, c.name as category_name, c.slug as category_slug,
    c.icon as category_icon, m.name as model_name, m.slug as model_slug, m.icon as model_icon,
    b.name as blogger_name, b.slug as blogger_slug
    FROM videos v
    LEFT JOIN categories c ON v.category_id = c.id
    LEFT JOIN ai_models m ON v.ai_model_id = m.id
    LEFT JOIN bloggers b ON v.blogger_id = b.id
    WHERE v.status = 'published' AND (v.platform IS NULL OR v.platform != '小红书')
    ORDER BY v.created_at DESC LIMIT 12`);

  const categories = cachedQuery(`SELECT c.*, (SELECT COUNT(*) FROM videos WHERE category_id = c.id AND status = 'published') as video_count FROM categories c ORDER BY c.sort_order`);

  // 获取每个分类下的子分类（全部显示）及视频
  const categoryTree = [];
  for (const cat of categories) {
    const subs = cachedQuery(`SELECT s.*, (SELECT COUNT(*) FROM videos WHERE subcategory_id = s.id AND status = 'published') as video_count
      FROM subcategories s WHERE s.category_id = ? ORDER BY s.sort_order`, [cat.id]);
    const subVideos = {};
    for (const sub of subs) {
      subVideos[sub.id] = cachedQuery(`SELECT v.id, v.title, v.thumbnail, v.url, v.duration, v.platform, v.embed_code
        FROM videos v WHERE v.subcategory_id = ? AND v.status = 'published'
        ORDER BY v.created_at DESC LIMIT 3`, [sub.id]);
    }
    categoryTree.push({ category: cat, subcategories: subs, subVideos });
  }

  const models = cachedQuery(`SELECT m.*, (SELECT COUNT(*) FROM videos WHERE ai_model_id = m.id AND status = 'published') as video_count FROM ai_models m ORDER BY m.sort_order`);
  const featuredBloggers = cachedQuery(`SELECT b.*, (SELECT COUNT(*) FROM videos WHERE blogger_id = b.id AND status = 'published') as video_count FROM bloggers b WHERE b.status = 'active' AND b.featured = 1 ORDER BY video_count DESC LIMIT 4`);

  // 小红书视频专区（进站内页面，有分析有笔记）
  const xiaohongshuVideos = cachedQuery(`SELECT v.id, v.title, v.url, v.platform, v.created_at,
    b.name as blogger_name, b.slug as blogger_slug
    FROM videos v
    LEFT JOIN bloggers b ON v.blogger_id = b.id
    WHERE v.platform = '小红书' AND v.status = 'published'
    ORDER BY v.created_at DESC LIMIT 20`);

  const bloggerCategories = {};
  for (const b of featuredBloggers) {
    bloggerCategories[b.id] = cachedQuery(`SELECT c.id, c.name, c.slug, c.icon, c.color, COUNT(*) as cnt
      FROM videos v JOIN categories c ON v.category_id = c.id
      WHERE v.blogger_id = ? AND v.status = 'published'
      GROUP BY c.id ORDER BY cnt DESC LIMIT 5`, [b.id]);
  }

  const works = getWorks();

  const stats = {
    totalVideos: get(`SELECT COUNT(*) as c FROM videos WHERE status = 'published'`).c,
    totalNotes: get(`SELECT COUNT(*) as c FROM learning_notes`).c,
    streak: get(`SELECT COUNT(*) as c FROM study_checkins`).c,
  };

  // ---- 生日倒计时（农历六月初七） ----
  const Lunar = require('lunar-javascript');
  const now = new Date();
  const thisYear = now.getFullYear();
  const lunarBd = Lunar.Lunar.fromYmd(thisYear, 6, 7);
  const solarBd = lunarBd.getSolar();
  const bdDate = new Date(solarBd.getYear(), solarBd.getMonth() - 1, solarBd.getDay());
  let birthday = {};
  if (bdDate < now) {
    const nextLunar = Lunar.Lunar.fromYmd(thisYear + 1, 6, 7);
    const nextSolar = nextLunar.getSolar();
    const nextDate = new Date(nextSolar.getYear(), nextSolar.getMonth() - 1, nextSolar.getDay());
    birthday = { month: nextSolar.getMonth(), day: nextSolar.getDay(), timestamp: nextDate.getTime(), isToday: false };
  } else {
    birthday = { month: solarBd.getMonth(), day: solarBd.getDay(), timestamp: bdDate.getTime(), isToday: bdDate.getTime() <= now.getTime() && bdDate.getTime() + 86400000 > now.getTime() };
  }

  // ---- 今日农历 ----
  const todaySolar = Lunar.Solar.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const todayLunar = todaySolar.getLunar();
  const lunarMonth = todayLunar.getMonthInChinese();
  const lunarDay = todayLunar.getDayInChinese();
  const lunarFestivals = todayLunar.getFestivals();
  const solarFestivals = todaySolar.getFestivals();
  const festivals = [...lunarFestivals, ...solarFestivals];
  const lunarStr = lunarMonth + '月' + lunarDay + (festivals.length ? ' · ' + festivals[0] : '');

  res.render('index', {
    title: 'shangtaopang-可与 · 个人站',
    featured,
    latest,
    categories,
    categoryTree,
    models,
    featuredBloggers,
    bloggerCategories,
    xiaohongshuVideos,
    works,
    stats,
    birthday,
    lunarStr,
    currentPage: 'home'
  });
});

// ---- 作品数据 ----
function getWorks() {
  return [
    { id: 1, title: '宁海谢氏家谱网站', desc: '下枫槎村谢氏家族谱系树，可视化展示家族世代关系。基于HTML/CSS/JS构建，支持交互式树形浏览。', url: 'http://8.160.117.120/pages/genealogy.html', icon: '🌳', tags: ['家族谱系', '数据可视化', 'HTML/CSS/JS'], detail: '以可视化树形结构展示家族世系关系，支持点击展开/折叠各分支，清晰呈现家族传承脉络。', highlights: ['交互式家族谱系树', '支持多代展开/折叠', '移动端响应式适配', '数据驱动的前端渲染'], techs: ['HTML5', 'CSS3', 'JavaScript', 'ECharts'] },
    { id: 2, title: '童寂 · 记录美好时光', desc: '家庭相册应用，用镜头讲述成长，记录生活中的每一个美好瞬间。基于Next.js全栈框架。', url: 'http://8.160.117.120:5000/', icon: '📸', tags: ['Next.js', '相册管理', '全栈应用'], detail: '支持照片上传、分类管理、时光轴浏览，珍藏温馨回忆。采用现代Web技术栈构建。', highlights: ['照片上传与分类管理', '时光轴浏览模式', '响应式多端适配', '全栈架构设计'], techs: ['Next.js', 'React', 'PostgreSQL', 'Tailwind CSS'] },
    { id: 3, title: 'shangtaopang-可与·记', desc: '个人网站与AI学习平台，集成视频分析、思维导图、笔记功能。', url: 'http://8.160.117.120:3003', icon: '🤖', tags: ['Node.js', 'AI分析', '学习管理'], detail: '个人品牌站，聚合多平台AI学习视频，智能分类、自动分析、思维导图、学习笔记、学习进度追踪。', highlights: ['多平台AI视频聚合', '智能分类与自动分析', '思维导图生成', '学习进度追踪'], techs: ['Node.js', 'Express', 'SQLite', 'Puppeteer', 'EJS'] },
    { id: 4, title: '凉山州五源兴农业科技', desc: '农业科技公司企业官网，展示品牌形象、产品服务与企业实力。', url: 'https://69c695dbb22f0c28ae53e9fb--stellular-syrniki-ccae4c.netlify.app', icon: '🌾', tags: ['企业官网', '农业科技', '响应式设计'], detail: '为企业打造的现代化品牌官网，涵盖公司介绍、产品展示、新闻动态等模块，采用响应式设计适配多端展示。', highlights: ['企业品牌形象展示', '产品与服务展示', '新闻动态更新', '多端响应式适配'], techs: ['HTML/CSS/JS', '响应式设计', 'Netlify部署'] },
    { id: 5, title: '云祥茗舍', desc: '茶空间装修设计，融合现代美学与传统茶文化，打造宁静雅致的品茗环境。', url: '#', icon: '🍵', tags: ['室内设计', '茶空间', '装修设计'], detail: '云祥茗舍是一个以茶文化为主题的空间设计项目。从空间布局、材质选择到灯光氛围，每一处都力求体现东方美学的简约与静谧。', highlights: ['茶文化空间设计', '现代东方美学', '灯光氛围营造', '材质与细节把控'], techs: ['空间设计', '软装搭配', '灯光设计'], photos: ['/uploads/works/yunxiang/photo1.jpg','/uploads/works/yunxiang/photo2.jpg','/uploads/works/yunxiang/photo3.jpg','/uploads/works/yunxiang/photo4.jpg','/uploads/works/yunxiang/photo5.jpg','/uploads/works/yunxiang/photo6.jpg','/uploads/works/yunxiang/photo7.jpg','/uploads/works/yunxiang/photo8.jpg','/uploads/works/yunxiang/photo9.jpg','/uploads/works/yunxiang/photo10.jpg','/uploads/works/yunxiang/photo11.jpg','/uploads/works/yunxiang/photo12.jpg','/uploads/works/yunxiang/photo13.jpg','/uploads/works/yunxiang/photo14.jpg','/uploads/works/yunxiang/photo15.jpg','/uploads/albums/2026-06-20_13-53-51_74.jpg','/uploads/albums/2026-06-20_13-54-23_75.jpg','/uploads/albums/2026-06-20_13-54-32_76.jpg'] },
  ];
}

// 作品展示页
app.get('/works', (req, res) => {
  const works = getWorks();
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  res.render('works', { title: '我的作品 - shangtaopang-可与', works, categories, currentPage: 'works' });
});

// 关于我
app.get('/about', (req, res) => {
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  res.render('about', { title: '关于我 - shangtaopang-可与', categories, currentPage: 'about' });
});

// 作品详情页
app.get('/works/:id', (req, res) => {
  const works = getWorks();
  const work = works.find(w => w.id === parseInt(req.params.id));
  if (!work) return res.status(404).render('error', { title: '未找到 - shangtaopang-可与', message: '该作品不存在' });

  // 推荐其他作品
  const related = works.filter(w => w.id !== work.id).slice(0, 3);
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);

  res.render('work-detail', {
    title: work.title + ' - shangtaopang-可与',
    work,
    related,
    categories,
    currentPage: 'works'
  });
});

// ---- 个人影集 ----
app.get('/gallery', (req, res) => {
  const albums = query(`SELECT a.*,
    (SELECT COUNT(*) FROM photos WHERE album_id = a.id) as photo_count,
    (SELECT CASE WHEN COUNT(*) > 0 AND SUM(CASE WHEN filename NOT LIKE '%.mp4' AND filename NOT LIKE '%.m4v' AND filename NOT LIKE '%.webm' THEN 1 ELSE 0 END) = 0 THEN 1 ELSE 0 END FROM photos WHERE album_id = a.id) as all_video
    FROM photo_albums a ORDER BY a.sort_order, a.created_at DESC`);
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  // 获取每个相册的封面图
  const albumCovers = {};
  for (const a of albums) {
    const cover = query(`SELECT filename FROM photos WHERE album_id = ? ORDER BY sort_order, id LIMIT 1`, [a.id]);
    albumCovers[a.id] = cover.length > 0 ? cover[0].filename : null;
  }
  res.render('gallery', { title: '个人影集 - shangtaopang-可与', albums, albumCovers, categories, currentPage: 'gallery' });
});

app.get('/gallery/:id', (req, res) => {
  const album = get(`SELECT * FROM photo_albums WHERE id = ?`, [req.params.id]);
  if (!album) return res.status(404).render('error', { title: '相册未找到', message: '' });
  const photos = query(`SELECT * FROM photos WHERE album_id = ? ORDER BY sort_order, id`, [album.id]);
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  res.render('gallery-album', { title: `${album.title} - shangtaopang-可与`, album, photos, categories, currentPage: 'gallery' });
});

// ---- 后台相册管理 ----
app.get('/admin/albums', authMiddleware, (req, res) => {
  const albums = query(`SELECT a.*, (SELECT COUNT(*) FROM photos WHERE album_id = a.id) as photo_count FROM photo_albums a ORDER BY a.created_at DESC`);
  // 获取每个相册的封面
  const covers = {};
  for (const a of albums) {
    const cover = query(`SELECT filename FROM photos WHERE album_id = ? ORDER BY id LIMIT 1`, [a.id]);
    covers[a.id] = cover.length > 0 ? cover[0].filename : null;
  }
  res.render('admin/albums', { title: '相册管理 - shangtaopang-可与', albums, covers, admin: req.admin });
});

app.post('/admin/albums/save', authMiddleware, (req, res) => {
  const { id, title, description, year, sort_order } = req.body;
  if (id) {
    run(`UPDATE photo_albums SET title=?, description=?, year=?, sort_order=? WHERE id=?`, [title, description, year, sort_order || 0, id]);
  } else {
    run(`INSERT INTO photo_albums (title, description, year, sort_order) VALUES (?,?,?,?)`, [title, description, year, sort_order || 0]);
  }
  res.redirect('/admin/albums');
});

app.post('/admin/albums/delete/:id', authMiddleware, (req, res) => {
  const photos = query(`SELECT filename FROM photos WHERE album_id = ?`, [req.params.id]);
  photos.forEach(p => { try { require('fs').unlinkSync(require('path').join(__dirname, 'public/uploads/albums', p.filename)); } catch {} });
  run(`DELETE FROM photos WHERE album_id = ?`, [req.params.id]);
  run(`DELETE FROM photo_albums WHERE id = ?`, [req.params.id]);
  res.redirect('/admin/albums');
});

// 上传照片
const fs = require('fs');
app.post('/admin/albums/upload/:albumId', authMiddleware, upload.array('photos', 50), (req, res) => {
  const albumId = req.params.albumId;
  const albumDir = path.join(__dirname, 'public/uploads/albums');
  if (!fs.existsSync(albumDir)) fs.mkdirSync(albumDir, { recursive: true });

  if (req.files) {
    req.files.forEach((f, i) => {
      // 移动到 albums 子目录
      const oldPath = path.join(__dirname, 'public/uploads', f.filename);
      const newPath = path.join(albumDir, f.filename);
      try { fs.renameSync(oldPath, newPath); } catch {}
      const dateTaken = req.body.date_taken || null;
      const photoDesc = req.body.photo_desc || null;
      run(`INSERT INTO photos (album_id, filename, original_name, description, date_taken, sort_order) VALUES (?,?,?,?,?,?)`,
        [albumId, '/uploads/albums/' + f.filename, f.originalname, photoDesc, dateTaken, i]);
    });
  }
  res.redirect('/admin/albums');
});

// 删除照片
app.post('/admin/albums/photo/delete/:id', authMiddleware, (req, res) => {
  const photo = get(`SELECT * FROM photos WHERE id = ?`, [req.params.id]);
  if (photo) {
    try { require('fs').unlinkSync(require('path').join(__dirname, 'public', photo.filename)); } catch {}
    run(`DELETE FROM photos WHERE id = ?`, [photo.id]);
  }
  res.redirect(req.get('referer') || '/admin/albums');
});

// 编辑照片
app.post('/admin/albums/photo/edit/:id', authMiddleware, (req, res) => {
  const { description, date_taken } = req.body;
  run(`UPDATE photos SET description=?, date_taken=? WHERE id=?`, [description || null, date_taken || null, req.params.id]);
  res.redirect(req.get('referer') || '/admin/albums');
});

// 查看相册照片列表（管理用）
app.get('/admin/albums/:id', authMiddleware, (req, res) => {
  const album = get(`SELECT * FROM photo_albums WHERE id = ?`, [req.params.id]);
  if (!album) return res.redirect('/admin/albums');
  const photos = query(`SELECT * FROM photos WHERE album_id = ? ORDER BY sort_order, id`, [album.id]);
  res.render('admin/album-photos', { title: `${album.title} - 照片管理`, album, photos, admin: req.admin });
});

// 分类页
app.get('/category/:slug', (req, res) => {
  const category = get(`SELECT * FROM categories WHERE slug = ?`, [req.params.slug]);
  if (!category) return res.status(404).render('error', { title: '分类未找到', message: '该分类不存在' });

  const subSlug = req.query.sub || '';
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  let subcategory = null;
  let videoSql = `SELECT v.*, m.name as model_name, m.slug as model_slug, m.icon as model_icon
    FROM videos v LEFT JOIN ai_models m ON v.ai_model_id = m.id
    WHERE v.category_id = ? AND v.status = 'published'`;
  let countSql = `SELECT COUNT(*) as count FROM videos WHERE category_id = ? AND status = 'published'`;
  const params = [category.id];

  if (subSlug) {
    subcategory = get(`SELECT * FROM subcategories WHERE category_id = ? AND slug = ?`, [category.id, subSlug]);
    if (subcategory) {
      videoSql += ` AND v.subcategory_id = ?`;
      countSql += ` AND subcategory_id = ?`;
      params.push(subcategory.id);
    }
  }

  videoSql += ' ORDER BY v.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const videos = query(videoSql, params);
  const total = get(countSql, [category.id].concat(subcategory ? [subcategory.id] : []));
  const subcategories = query(`SELECT s.*, (SELECT COUNT(*) FROM videos WHERE subcategory_id = s.id AND status = 'published') as video_count
    FROM subcategories s WHERE s.category_id = ? ORDER BY s.sort_order`, [category.id]);

  res.render('category', {
    title: `${subcategory ? subcategory.name + ' - ' : ''}${category.name} - shangtaopang-可与`,
    category, videos, subcategories, subcategory,
    page, totalPages: Math.ceil(total.count / limit),
    currentPage: 'category'
  });
});

// AI模型页
app.get('/model/:slug', (req, res) => {
  const model = get(`SELECT * FROM ai_models WHERE slug = ?`, [req.params.slug]);
  if (!model) return res.status(404).render('error', { title: '模型未找到', message: '该AI模型不存在' });

  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  const videos = query(`SELECT v.*, c.name as category_name, c.slug as category_slug, c.icon as category_icon
    FROM videos v LEFT JOIN categories c ON v.category_id = c.id
    WHERE v.ai_model_id = ? AND v.status = 'published'
    ORDER BY v.created_at DESC LIMIT ? OFFSET ?`, [model.id, limit, offset]);

  const total = get(`SELECT COUNT(*) as count FROM videos WHERE ai_model_id = ? AND status = 'published'`, [model.id]);

  res.render('model', {
    title: `${model.name} - shangtaopang-可与`,
    model,
    videos,
    page,
    totalPages: Math.ceil(total.count / limit),
    currentPage: 'model'
  });
});

// 视频详情页
app.get('/video/:id', (req, res) => {
  const video = get(`SELECT v.*, c.name as category_name, c.slug as category_slug,
    c.icon as category_icon, c.color as category_color,
    m.name as model_name, m.slug as model_slug, m.icon as model_icon, m.company as model_company,
    b.name as blogger_name, b.slug as blogger_slug, b.platform as blogger_platform, b.avatar as blogger_avatar
    FROM videos v
    LEFT JOIN categories c ON v.category_id = c.id
    LEFT JOIN ai_models m ON v.ai_model_id = m.id
    LEFT JOIN bloggers b ON v.blogger_id = b.id
    WHERE v.id = ? AND v.status = 'published'`, [req.params.id]);

  if (!video) return res.status(404).render('error', { title: '视频未找到', message: '该视频不存在' });

  // 增加浏览量
  run(`UPDATE videos SET views = views + 1 WHERE id = ?`, [video.id]);

  // 相关视频
  const related = query(`SELECT v.*, c.name as category_name, c.icon as category_icon
    FROM videos v LEFT JOIN categories c ON v.category_id = c.id
    WHERE v.category_id = ? AND v.id != ? AND v.status = 'published'
    ORDER BY v.created_at DESC LIMIT 6`, [video.category_id, video.id]);

  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);

  // 加载AI分析数据和学习笔记
  const { generateFullAnalysis } = require('./analyzer');
  const note = get(`SELECT * FROM learning_notes WHERE video_id = ? ORDER BY updated_at DESC LIMIT 1`, [video.id]);
  let analysis = null;
  if (note?.analysis_data) {
    try { analysis = JSON.parse(note.analysis_data); } catch {}
  }
  if (!analysis) {
    analysis = generateFullAnalysis(video);
  }

  res.render('video', {
    title: `${video.title} - shangtaopang-可与`,
    video,
    related,
    categories,
    analysis,
    note,
    currentPage: 'video'
  });
});

// 搜索
app.get('/search', (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return res.redirect('/');

  const videos = query(`SELECT v.*, c.name as category_name, c.slug as category_slug,
    c.icon as category_icon, m.name as model_name, m.slug as model_slug, m.icon as model_icon
    FROM videos v
    LEFT JOIN categories c ON v.category_id = c.id
    LEFT JOIN ai_models m ON v.ai_model_id = m.id
    WHERE v.status = 'published' AND (v.title LIKE ? OR v.description LIKE ? OR v.tags LIKE ?)
    ORDER BY v.created_at DESC LIMIT 30`, [`%${q}%`, `%${q}%`, `%${q}%`]);

  res.render('search', {
    title: `搜索: ${q} - shangtaopang-可与`,
    query: q,
    videos,
    currentPage: 'search'
  });
});

// 所有分类页
app.get('/categories', (req, res) => {
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  res.render('categories', { title: '全部分类 - shangtaopang-可与', categories, currentPage: 'categories' });
});

// 所有模型页
app.get('/models', (req, res) => {
  const models = cachedQuery(`SELECT * FROM ai_models ORDER BY sort_order`);
  res.render('models', { title: '全部AI模型 - shangtaopang-可与', models, currentPage: 'models' });
});

// 博主列表页
app.get('/bloggers', (req, res) => {
  const bloggers = query(`SELECT b.*, (SELECT COUNT(*) FROM videos WHERE blogger_id = b.id AND status = 'published') as video_count
    FROM bloggers b WHERE b.status = 'active' ORDER BY b.video_count DESC`);
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  res.render('bloggers', { title: '博主专栏 - shangtaopang-可与', bloggers, categories, currentPage: 'bloggers' });
});

// 博主详情页
app.get('/blogger/:slug', (req, res) => {
  const blogger = get(`SELECT * FROM bloggers WHERE slug = ? AND status = 'active'`, [req.params.slug]);
  if (!blogger) return res.status(404).render('error', { title: '博主未找到', message: '该博主不存在' });

  const videos = query(`SELECT v.*, c.name as category_name, c.slug as category_slug,
    c.icon as category_icon, m.name as model_name, m.slug as model_slug, m.icon as model_icon
    FROM videos v
    LEFT JOIN categories c ON v.category_id = c.id
    LEFT JOIN ai_models m ON v.ai_model_id = m.id
    WHERE v.blogger_id = ? AND v.status = 'published'
    ORDER BY v.created_at DESC`, [blogger.id]);

  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);

  res.render('blogger', { title: `${blogger.name} - shangtaopang-可与`, blogger, videos, categories, currentPage: 'blogger' });
});

// ---- 收藏/取消收藏 ----
app.post('/api/favorite/:videoId', (req, res) => {
  const exists = get(`SELECT id FROM favorites WHERE video_id = ?`, [req.params.videoId]);
  if (exists) {
    run(`DELETE FROM favorites WHERE id = ?`, [exists.id]);
    res.json({ favorited: false });
  } else {
    run(`INSERT INTO favorites (video_id) VALUES (?)`, [req.params.videoId]);
    res.json({ favorited: true });
  }
});

app.get('/api/favorites', (req, res) => {
  const ids = query(`SELECT video_id FROM favorites ORDER BY created_at DESC`);
  res.json({ ids: ids.map(r => r.video_id) });
});

// ---- 学习打卡 ----
app.post('/api/checkin', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const exists = get(`SELECT id FROM study_checkins WHERE checkin_date = ?`, [today]);
  if (!exists) {
    run(`INSERT INTO study_checkins (checkin_date) VALUES (?)`, [today]);
  }
  res.json({ checked: true, date: today });
});

// ---- 留言 ----
app.post('/api/contact', (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !message) return res.status(400).json({ error: '请填写姓名和留言内容' });
    if (name.length > 50 || message.length > 2000) return res.status(400).json({ error: '内容过长' });
    run(`INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)`, [name.trim(), (email || '').trim(), message.trim()]);
    saveDatabase();
    res.json({ success: true, message: '留言已发送，谢谢！' });
  } catch (e) {
    res.status(500).json({ error: '发送失败，请稍后再试' });
  }
});

// ---- 学习统计页 ----
app.get('/stats', (req, res) => {
  const totalVideos = get(`SELECT COUNT(*) as c FROM videos WHERE status = 'published'`).c;
  const totalNotes = get(`SELECT COUNT(*) as c FROM learning_notes`).c;
  const totalViews = get(`SELECT COALESCE(SUM(views), 0) as c FROM videos`).c;
  const totalFavorites = get(`SELECT COUNT(*) as c FROM favorites`).c;

  // 打卡连续天数
  const checkins = query(`SELECT checkin_date FROM study_checkins ORDER BY checkin_date DESC`);
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < checkins.length; i++) {
    const d = new Date(checkins[i].checkin_date);
    const diff = Math.floor((today - d) / 86400000);
    if (diff === streak) { streak++; } else if (diff > streak) break;
  }

  // 最近一周打卡
  const weekCheckins = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    weekCheckins.push({ date: ds, checked: checkins.some(c => c.checkin_date === ds) });
  }

  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  res.render('stats', {
    title: '学习统计 - shangtaopang-可与',
    stats: { totalVideos, totalNotes, totalViews, totalFavorites, streak },
    weekCheckins, categories, currentPage: 'stats'
  });
});

// ---- 学习总结页 ----
app.get('/study', (req, res) => {
  const { status: filterStatus } = req.query;
  let sql = `SELECT n.*, v.title as video_title, v.platform, v.thumbnail, v.url,
    c.name as category_name, c.icon as category_icon
    FROM learning_notes n
    LEFT JOIN videos v ON n.video_id = v.id
    LEFT JOIN categories c ON v.category_id = c.id`;
  const params = [];

  if (filterStatus) {
    sql += ' WHERE n.status = ?';
    params.push(filterStatus);
  }
  sql += ' ORDER BY n.updated_at DESC';

  const notes = query(sql, params);
  const stats = {
    total: notes.length,
    planned: query(`SELECT COUNT(*) as c FROM learning_notes WHERE status = 'planned'`)[0].c,
    watching: query(`SELECT COUNT(*) as c FROM learning_notes WHERE status = 'watching'`)[0].c,
    completed: query(`SELECT COUNT(*) as c FROM learning_notes WHERE status = 'completed'`)[0].c,
  };
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);

  res.render('study', { title: '学习总结 - shangtaopang-可与', notes, stats, filterStatus, categories, currentPage: 'study' });
});

// 添加/编辑学习笔记页
app.get('/study/new', (req, res) => {
  const { video_id } = req.query;
  let video = null;
  if (video_id) video = get('SELECT * FROM videos WHERE id = ?', [video_id]);
  const videos = query(`SELECT id, title FROM videos WHERE status = 'published' ORDER BY created_at DESC LIMIT 50`);
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  res.render('study-form', { title: '添加学习笔记 - shangtaopang-可与', note: null, video, videos, categories, currentPage: 'study' });
});

app.get('/study/edit/:id', (req, res) => {
  const note = get(`SELECT * FROM learning_notes WHERE id = ?`, [req.params.id]);
  if (!note) return res.redirect('/study');
  let video = null;
  if (note.video_id) video = get('SELECT id, title FROM videos WHERE id = ?', [note.video_id]);
  const videos = query(`SELECT id, title FROM videos WHERE status = 'published' ORDER BY created_at DESC LIMIT 50`);
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  res.render('study-form', { title: '编辑学习笔记 - shangtaopang-可与', note, video, videos, categories, currentPage: 'study' });
});

// 保存学习笔记
app.post('/study/save', (req, res) => {
  const { id, video_id, title, summary, content, key_points, status, rating } = req.body;
  if (id) {
    run(`UPDATE learning_notes SET video_id=?, title=?, summary=?, content=?, key_points=?, status=?, rating=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [video_id || null, title, summary, content, key_points, status || 'planned', parseInt(rating) || 0, id]);
  } else {
    run(`INSERT INTO learning_notes (video_id, title, summary, content, key_points, status, rating) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [video_id || null, title, summary, content, key_points, status || 'planned', parseInt(rating) || 0]);
  }
  res.redirect('/study');
});

// 删除笔记
app.post('/study/delete/:id', (req, res) => {
  run('DELETE FROM learning_notes WHERE id = ?', [req.params.id]);
  res.redirect('/study');
});

// ---- 视频分析页 ----
app.get('/study/analyze/:videoId', (req, res) => {
  const video = get(`SELECT v.*, c.name as category_name, c.slug as category_slug,
    c.icon as category_icon, m.name as model_name, m.slug as model_slug, m.icon as model_icon
    FROM videos v LEFT JOIN categories c ON v.category_id = c.id
    LEFT JOIN ai_models m ON v.ai_model_id = m.id
    WHERE v.id = ? AND v.status = 'published'`, [req.params.videoId]);

  if (!video) return res.status(404).render('error', { title: '视频未找到', message: '该视频不存在' });

  // 查找已有的学习笔记（含分析数据）
  const note = get(`SELECT * FROM learning_notes WHERE video_id = ? ORDER BY updated_at DESC LIMIT 1`, [video.id]);

  // 生成分析数据
  let analysis = null;
  if (note?.analysis_data) {
    try { analysis = JSON.parse(note.analysis_data); } catch {}
  }
  if (!analysis) {
    analysis = generateFullAnalysis(video);
  }

  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);

  res.render('analyze', {
    title: `视频分析 - ${video.title} - shangtaopang-可与`,
    video, note, analysis, categories, currentPage: 'study'
  });
});

// 保存分析数据到笔记
app.post('/study/analyze/save', (req, res) => {
  const { video_id, analysis_data, note_id } = req.body;
  if (note_id) {
    run(`UPDATE learning_notes SET analysis_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [analysis_data, note_id]);
  } else {
    // 创建新笔记并保存分析
    const video = get('SELECT title FROM videos WHERE id = ?', [video_id]);
    run(`INSERT INTO learning_notes (video_id, title, analysis_data, status) VALUES (?, ?, ?, 'watching')`,
      [video_id, `分析报告：${video?.title || ''}`, analysis_data]);
  }
  res.json({ success: true });
});

// ---- API 路由 (公开) ----

app.get('/api/videos', (req, res) => {
  const { category, model, platform, page = 1, limit = 20 } = req.query;
  let sql = `SELECT v.*, c.name as category_name, c.slug as category_slug, c.icon as category_icon,
    m.name as model_name, m.slug as model_slug, m.icon as model_icon
    FROM videos v LEFT JOIN categories c ON v.category_id = c.id
    LEFT JOIN ai_models m ON v.ai_model_id = m.id WHERE v.status = 'published'`;
  const params = [];

  if (category) { sql += ' AND c.slug = ?'; params.push(category); }
  if (model) { sql += ' AND m.slug = ?'; params.push(model); }
  if (platform) { sql += ' AND v.platform = ?'; params.push(platform); }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  sql += ' ORDER BY v.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const videos = query(sql, params);
  res.json({ videos });
});

app.get('/api/categories', (req, res) => {
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  res.json({ categories });
});

app.get('/api/models', (req, res) => {
  const models = cachedQuery(`SELECT * FROM ai_models ORDER BY sort_order`);
  res.json({ models });
});

app.get('/api/bloggers', (req, res) => {
  const bloggers = query(`SELECT * FROM bloggers WHERE status = 'active' ORDER BY video_count DESC`);
  res.json({ bloggers });
});

// 城市坐标（用于里程计算）
const CITY_COORDS = {
  '宁海': [29.29,121.43],'成都': [30.57,104.07],'上海': [31.23,121.47],'北京': [39.90,116.40],
  '南京': [32.06,118.80],'杭州': [30.28,120.15],'深圳': [22.54,114.06],'广州': [23.13,113.26],
  '武汉': [30.58,114.30],'重庆': [29.56,106.55],'西安': [34.26,108.94],'长沙': [28.23,112.94],
  '郑州': [34.75,113.63],'合肥': [31.82,117.23],'宁波': [29.87,121.54],'亳州': [33.84,115.78],
  '亳州南': [33.83,115.77],'南京南': [31.97,118.79],'西安北': [34.38,108.93],'成都东': [30.63,104.14],
  '城固北': [33.16,107.31],'西昌西': [27.86,102.23],'甘洛南': [28.97,102.77],'金口河南': [29.25,103.07],'峨边南': [29.23,103.26],'夹江': [29.74,103.57],'眉山': [30.06,103.83],'成都西': [30.68,103.96],'崇州': [30.63,103.67],'西昌': [27.89,102.26],
  '商丘': [34.41,115.65],'郑州东': [34.76,113.77],'洛阳龙门': [34.62,112.45],'华山北': [34.57,110.08],
  '天津南': [39.06,117.07],'北京南': [39.86,116.38],'济南西': [36.67,116.88],'徐州东': [34.26,117.20],
  '杭州东': [30.28,120.21],'南昌西': [28.60,115.86],'长沙南': [28.15,113.05],'广州南': [23.02,113.27],
};

// ---- 云祥留声机 ----
app.get('/gramophone', (req, res) => {
  res.render('gramophone', { title: '云祥留声机 - shangtaopang-可与', currentPage: 'gramophone' });
});

// ---- 出行轨迹 ----
app.get('/travel', (req, res) => {
  const records = query(`SELECT * FROM travel_records ORDER BY start_date DESC`);
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);

  // 统计
  const totalTrips = records.length;
  const cities = [...new Set(records.map(r => r.destination))];
  let totalDays = 0;
  records.forEach(r => {
    if (r.start_date && r.end_date) {
      totalDays += Math.ceil((new Date(r.end_date) - new Date(r.start_date)) / 86400000) + 1;
    }
  });

  // 计算每条记录的里程
  function calcDistance(from, to) {
    if (!from || !to) return 0;
    const R = 6371;
    const dlat = (to[0] - from[0]) * Math.PI / 180;
    const dlng = (to[1] - from[1]) * Math.PI / 180;
    const a = Math.sin(dlat/2)**2 + Math.cos(from[0]*Math.PI/180) * Math.cos(to[0]*Math.PI/180) * Math.sin(dlng/2)**2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  }

  records.forEach(r => {
    let km = 0;
    if (r.segments) {
      try {
        const segs = JSON.parse(r.segments);
        segs.forEach(s => {
          const from = CITY_COORDS[s.from];
          const to = CITY_COORDS[s.to];
          if (from && to) km += calcDistance(from, to);
        });
      } catch(e) {}
    }
    r.distance = km;
  });

  // 近2年月度分布 & 里程
  const months = {};
  const monthKm = {};
  records.forEach(r => {
    if (r.start_date) {
      const m = r.start_date.slice(0, 7);
      months[m] = (months[m] || 0) + 1;
    }
    // 计算里程
    if (r.segments) {
      try {
        const segs = JSON.parse(r.segments);
        let totalKm = 0;
        segs.forEach(s => {
          const from = CITY_COORDS[s.from];
          const to = CITY_COORDS[s.to];
          if (from && to) {
            const R = 6371;
            const dlat = (to[0] - from[0]) * Math.PI / 180;
            const dlng = (to[1] - from[1]) * Math.PI / 180;
            const a = Math.sin(dlat/2)**2 + Math.cos(from[0]*Math.PI/180) * Math.cos(to[0]*Math.PI/180) * Math.sin(dlng/2)**2;
            totalKm += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          }
        });
        if (r.start_date && totalKm > 0) {
          const m = r.start_date.slice(0, 7);
          monthKm[m] = (monthKm[m] || 0) + Math.round(totalKm);
        }
      } catch(e) {}
    }
  });

  res.render('travel', {
    title: '出行轨迹 - shangtaopang-可与',
    records, cities, totalTrips, totalDays, months, monthKm,
    categories, currentPage: 'travel'
  });
});

// 后台出行管理
app.get('/admin/travel', authMiddleware, (req, res) => {
  const records = query(`SELECT * FROM travel_records ORDER BY start_date DESC`);
  const vehicles = query(`SELECT DISTINCT vehicle FROM travel_records WHERE vehicle IS NOT NULL AND vehicle != '' ORDER BY vehicle`);
  const allCities = query(`SELECT DISTINCT city FROM (
    SELECT departure as city FROM travel_records WHERE departure IS NOT NULL
    UNION SELECT destination as city FROM travel_records WHERE destination IS NOT NULL
  ) ORDER BY city`);
  res.render('admin/travel', { title: '出行管理 - shangtaopang-可与', records, admin: req.admin, vehicles: vehicles.map(v => v.vehicle), allCities: allCities.map(c => c.city) });
});

app.post('/admin/travel/save', authMiddleware, (req, res) => {
  let { id, departure, destination, start_date, end_date, purpose, transport, notes, vehicle, depart_time, arrive_time, segments, full_route } = req.body;
  // 过滤空段
  if (segments) {
    try {
      const parsed = JSON.parse(segments);
      segments = JSON.stringify(parsed.filter(s => s.from && s.to));
    } catch(e) {}
  }
  const segStr = segments || null;
  const routeStr = full_route || null;
  const transVal = transport || 'train';
  const vehVal = vehicle || null;
  const depTimeVal = depart_time || null;
  const arrTimeVal = arrive_time || null;
  if (id) {
    run(`UPDATE travel_records SET departure=?, destination=?, start_date=?, end_date=?, purpose=?, transport=?, notes=?, vehicle=?, depart_time=?, arrive_time=?, segments=?, full_route=? WHERE id=?`,
      [departure || '宁海', destination, start_date, end_date || null, purpose || '', transVal, notes || '', vehVal, depTimeVal, arrTimeVal, segStr, routeStr, id]);
  } else {
    run(`INSERT INTO travel_records (departure, destination, start_date, end_date, purpose, transport, notes, vehicle, depart_time, arrive_time, segments, full_route) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [departure || '宁海', destination, start_date, end_date || null, purpose || '', transVal, notes || '', vehVal, depTimeVal, arrTimeVal, segStr, routeStr]);
  }
  res.redirect('/admin/travel');
});

app.post('/admin/travel/delete/:id', authMiddleware, (req, res) => {
  run(`DELETE FROM travel_records WHERE id = ?`, [req.params.id]);
  res.redirect('/admin/travel');
});

// ---- 内置常用车次数据库 ----
const TRAIN_DB = {
  'G820_NINGHAI_BEIJING': {
    name: 'G820', from: '宁海', to: '北京南',
    stops: [
      { station: '宁海', arrive: '', depart: '08:49' },
      { station: '奉化', arrive: '09:04', depart: '09:06' },
      { station: '宁波', arrive: '09:25', depart: '09:32' },
      { station: '余姚北', arrive: '09:52', depart: '09:54' },
      { station: '杭州东', arrive: '10:26', depart: '10:32' },
      { station: '湖州', arrive: '10:53', depart: '10:55' },
      { station: '宜兴', arrive: '11:21', depart: '11:24' },
      { station: '溧阳', arrive: '11:35', depart: '11:38' },
      { station: '句容西', arrive: '11:58', depart: '12:00' },
      { station: '南京南', arrive: '12:12', depart: '12:21' },
      { station: '滁州', arrive: '12:39', depart: '12:44' },
      { station: '蚌埠南', arrive: '13:13', depart: '13:19' },
      { station: '徐州东', arrive: '13:56', depart: '13:58' },
      { station: '曲阜东', arrive: '14:35', depart: '14:43' },
      { station: '济南西', arrive: '15:26', depart: '15:31' },
      { station: '天津南', arrive: '16:37', depart: '16:40' },
      { station: '北京南', arrive: '17:16', depart: '' },
    ]
  }
};

// ---- 车次查询 API（自动爬取全国车次） ----
const axios = require('axios');

app.get('/api/train/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim();
    const fromFilter = req.query.from;
    const toFilter = req.query.to;

    // 先查内置数据库（匹配车次号，起点站在路线中）
    for (const key of Object.keys(TRAIN_DB)) {
      const t = TRAIN_DB[key];
      if (t.name === code) {
        const stops = t.stops;
        // 如果指定了from，确认起点站在路线中
        if (fromFilter) {
          const fromIdx = stops.findIndex(s => s.station.includes(fromFilter));
          if (fromIdx >= 0) {
            let filtered = stops.slice(fromIdx);
            if (toFilter) {
              const toIdx = filtered.findIndex(s => s.station.includes(toFilter));
              if (toIdx >= 0) filtered = filtered.slice(0, toIdx + 1);
            }
            return res.json({ found: true, train: { name: code, from: filtered[0].station, to: filtered[filtered.length-1].station, stops: filtered } });
          }
        }
      }
    }

    // 从网络抓取
    const url = `https://train.hao86.com/${code}/`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });

    const html = response.data;
    const stops = [];
    // 解析表格
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    for (const row of rows) {
      const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/g);
      if (!cells || cells.length < 5) continue;

      const getCellText = (idx) => {
        if (!cells[idx]) return '';
        return cells[idx].replace(/<[^>]+>/g, '').trim();
      };

      let station = getCellText(1);
      const arrive = getCellText(3);
      const depart = getCellText(4);

      // 清理站名（去掉多余的域名等）
      station = station.replace(/train\.hao86\.com.*$/, '').replace(/\.com.*$/, '').trim();

      if (station && !station.match(/^\d+$/) && station !== '站名' && station.length < 20) {
        stops.push({
          station: station,
          arrive: arrive === '----' ? '' : arrive,
          depart: depart === '----' ? '' : depart
        });
      }
    }

    if (stops.length > 0) {
      const fromFilter = req.query.from;
      const toFilter = req.query.to;
      let filteredStops = stops;

      // 验证起点站是否存在
      if (fromFilter) {
        const fromIdx = stops.findIndex(s => s.station.includes(fromFilter));
        if (fromIdx < 0) {
          // 起点不在该线路中 → 搜索到错误版本
          return res.json({
            found: false,
            message: `车次 ${code} 的线路中未找到「${fromFilter}」站，当前查到的是 ${stops[0].station}→${stops[stops.length-1].station} 版本。请检查车次号是否正确，或从内置数据库匹配`
          });
        }
        filteredStops = filteredStops.slice(fromIdx);
      }
      if (toFilter) {
        const toIdx = filteredStops.findIndex(s => s.station.includes(toFilter));
        if (toIdx < 0) {
          return res.json({
            found: false,
            message: `车次 ${code} 的线路中未找到「${toFilter}」站`
          });
        }
        filteredStops = filteredStops.slice(0, toIdx + 1);
      }

      res.json({
        found: true,
        train: {
          name: code,
          from: filteredStops[0].station,
          to: filteredStops[filteredStops.length - 1].station,
          stops: filteredStops
        }
      });
    } else {
      res.json({ found: false, message: '未找到该车次信息' });
    }
  } catch (err) {
    res.json({ found: false, message: '查询失败: ' + (err.message || '') });
  }
});

// ---- 管理后台路由 ----
app.get('/admin/login', (req, res) => {
  res.render('admin/login', { title: '管理员登录 - shangtaopang-可与', error: null });
});

// 登录接口（有频率限制）
app.post('/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const admin = get(`SELECT * FROM admins WHERE username = ?`, [username]);

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.render('admin/login', { title: '管理员登录 - shangtaopang-可与', error: '用户名或密码错误' });
  }

  const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.redirect('/admin/dashboard');
});

// 退出登录
app.get('/admin/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/admin/login');
});

// 管理后台页面 (需要登录)
app.get('/admin/dashboard', authMiddleware, (req, res) => {
  const stats = {
    videos: get(`SELECT COUNT(*) as count FROM videos`).count,
    categories: get(`SELECT COUNT(*) as count FROM categories`).count,
    models: get(`SELECT COUNT(*) as count FROM ai_models`).count,
    bloggers: get(`SELECT COUNT(*) as count FROM bloggers WHERE status = 'active'`).count,
    published: get(`SELECT COUNT(*) as count FROM videos WHERE status = 'published'`).count,
    totalViews: get(`SELECT COALESCE(SUM(views), 0) as count FROM videos`).count,
    unreadMessages: get(`SELECT COUNT(*) as count FROM contact_messages WHERE is_read = 0`).count,
  };
  const recentVideos = query(`SELECT v.*, c.name as category_name FROM videos v
    LEFT JOIN categories c ON v.category_id = c.id ORDER BY v.created_at DESC LIMIT 10`);
  res.render('admin/dashboard', { title: '管理后台 - shangtaopang-可与', stats, recentVideos, admin: req.admin });
});

// 视频管理
app.get('/admin/videos', authMiddleware, (req, res) => {
  const videos = query(`SELECT v.*, c.name as category_name, m.name as model_name
    FROM videos v LEFT JOIN categories c ON v.category_id = c.id
    LEFT JOIN ai_models m ON v.ai_model_id = m.id ORDER BY v.created_at DESC`);
  res.render('admin/videos', { title: '视频管理 - shangtaopang-可与', videos, admin: req.admin });
});

// 添加视频页
app.get('/admin/videos/new', authMiddleware, (req, res) => {
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  const models = cachedQuery(`SELECT * FROM ai_models ORDER BY sort_order`);
  const bloggers = query(`SELECT * FROM bloggers WHERE status = 'active' ORDER BY name`);
  const subcategories = query(`SELECT * FROM subcategories ORDER BY category_id, sort_order`);
  res.render('admin/video-form', { title: '添加视频 - shangtaopang-可与', video: null, categories, models, bloggers, subcategories, admin: req.admin });
});

// 编辑视频页
app.get('/admin/videos/edit/:id', authMiddleware, (req, res) => {
  const video = get(`SELECT * FROM videos WHERE id = ?`, [req.params.id]);
  if (!video) return res.redirect('/admin/videos');
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  const models = cachedQuery(`SELECT * FROM ai_models ORDER BY sort_order`);
  const bloggers = query(`SELECT * FROM bloggers WHERE status = 'active' ORDER BY name`);
  const subcategories = query(`SELECT * FROM subcategories ORDER BY category_id, sort_order`);
  res.render('admin/video-form', { title: '编辑视频 - shangtaopang-可与', video, categories, models, bloggers, subcategories, admin: req.admin });
});

// 保存视频
app.post('/admin/videos/save', authMiddleware, upload.single('thumbnail'), (req, res) => {
  let { id, title, description, url, embed_code, embed_type, platform, category_id, ai_model_id, blogger_id, subcategory_id, tags, duration, source_author, source_link, featured } = req.body;

  let thumbnail = req.body.current_thumbnail || '';
  if (req.file) thumbnail = '/uploads/' + req.file.filename;

  // 自动分类：未手动指定时从标题智能识别
  const auto = classifyVideo(title || '', description || '');
  const finalCat = category_id || auto.categoryId || null;
  const finalModel = ai_model_id || auto.modelId || null;
  let finalSub = subcategory_id || null;
  if (!finalSub && auto.subcategorySlug) {
    const sub = query(`SELECT id FROM subcategories WHERE slug = ?`, [auto.subcategorySlug]);
    if (sub.length > 0) finalSub = sub[0].id;
  }

  if (id) {
    run(`UPDATE videos SET title=?, description=?, url=?, embed_code=?, embed_type=?,
      platform=?, category_id=?, ai_model_id=?, blogger_id=?, subcategory_id=?, tags=?, thumbnail=?, duration=?,
      source_author=?, source_link=?, featured=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`,
      [title, description, url, embed_code, embed_type || 'iframe', platform,
       finalCat, finalModel, blogger_id || null, finalSub, tags, thumbnail, duration,
       source_author, source_link, featured ? 1 : 0, id]);
  } else {
    run(`INSERT INTO videos (title, description, url, embed_code, embed_type, platform,
      category_id, ai_model_id, blogger_id, subcategory_id, tags, thumbnail, duration, source_author, source_link, featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, url, embed_code, embed_type || 'iframe', platform,
       finalCat, finalModel, blogger_id || null, finalSub, tags, thumbnail, duration,
       source_author, source_link, featured ? 1 : 0]);
  }

  res.redirect('/admin/videos');
});

// 删除视频
app.post('/admin/videos/delete/:id', authMiddleware, (req, res) => {
  run(`DELETE FROM videos WHERE id = ?`, [req.params.id]);
  res.redirect('/admin/videos');
});

// 分类管理
app.get('/admin/categories', authMiddleware, (req, res) => {
  const categories = cachedQuery(`SELECT c.*, (SELECT COUNT(*) FROM videos WHERE category_id = c.id) as video_count
    FROM categories c ORDER BY c.sort_order`);
  res.render('admin/categories', { title: '分类管理 - shangtaopang-可与', categories, admin: req.admin });
});

app.post('/admin/categories/save', authMiddleware, (req, res) => {
  const { id, name, slug, icon, description, color, sort_order } = req.body;
  if (id) {
    run(`UPDATE categories SET name=?, slug=?, icon=?, description=?, color=?, sort_order=? WHERE id=?`,
      [name, slug, icon, description, color, sort_order || 0, id]);
  } else {
    run(`INSERT INTO categories (name, slug, icon, description, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, slug, icon, description, color, sort_order || 0]);
  }
  res.redirect('/admin/categories');
});

app.post('/admin/categories/delete/:id', authMiddleware, (req, res) => {
  run(`DELETE FROM categories WHERE id = ?`, [req.params.id]);
  res.redirect('/admin/categories');
});

// AI模型管理
app.get('/admin/models', authMiddleware, (req, res) => {
  const models = cachedQuery(`SELECT m.*, (SELECT COUNT(*) FROM videos WHERE ai_model_id = m.id) as video_count
    FROM ai_models m ORDER BY m.sort_order`);
  res.render('admin/models', { title: 'AI模型管理 - shangtaopang-可与', models, admin: req.admin });
});

app.post('/admin/models/save', authMiddleware, (req, res) => {
  const { id, name, slug, icon, company, description, color, sort_order } = req.body;
  if (id) {
    run(`UPDATE ai_models SET name=?, slug=?, icon=?, company=?, description=?, color=?, sort_order=? WHERE id=?`,
      [name, slug, icon, company, description, color, sort_order || 0, id]);
  } else {
    run(`INSERT INTO ai_models (name, slug, icon, company, description, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, slug, icon, company, description, color, sort_order || 0]);
  }
  res.redirect('/admin/models');
});

app.post('/admin/models/delete/:id', authMiddleware, (req, res) => {
  run(`DELETE FROM ai_models WHERE id = ?`, [req.params.id]);
  res.redirect('/admin/models');
});

// ---- 子分类管理 ----
app.get('/admin/subcategories', authMiddleware, (req, res) => {
  const subs = query(`SELECT s.*, c.name as category_name, c.icon as category_icon,
    (SELECT COUNT(*) FROM videos WHERE subcategory_id = s.id) as video_count
    FROM subcategories s LEFT JOIN categories c ON s.category_id = c.id
    ORDER BY s.category_id, s.sort_order`);
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  res.render('admin/subcategories', { title: '子分类管理 - shangtaopang-可与', subs, categories, admin: req.admin });
});

app.post('/admin/subcategories/save', authMiddleware, (req, res) => {
  const { id, category_id, name, slug, icon, description, sort_order } = req.body;
  if (id) {
    run(`UPDATE subcategories SET category_id=?, name=?, slug=?, icon=?, description=?, sort_order=? WHERE id=?`,
      [category_id, name, slug, icon, description, sort_order || 0, id]);
  } else {
    run(`INSERT INTO subcategories (category_id, name, slug, icon, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [category_id, name, slug, icon, description, sort_order || 0]);
  }
  res.redirect('/admin/subcategories');
});

app.post('/admin/subcategories/delete/:id', authMiddleware, (req, res) => {
  run(`DELETE FROM subcategories WHERE id = ?`, [req.params.id]);
  res.redirect('/admin/subcategories');
});

// ---- 自动生成视频封面 ----
app.post('/admin/videos/generate-cover/:id', authMiddleware, async (req, res) => {
  const video = get(`SELECT * FROM videos WHERE id = ?`, [req.params.id]);
  if (!video) return res.status(404).json({ error: '视频不存在' });

  try {
    const { execSync } = require('child_process');
    const prompt = `视频封面图，标题：${video.title}，科技感，深色背景紫色渐变，简洁现代适合做视频缩略图`;
    const result = JSON.parse(execSync(`bl image generate --prompt "${prompt.replace(/"/g, '\\"')}" --output json`, { timeout: 120000 }).toString());
    if (result.saved && result.saved[0]) {
      const srcPath = result.saved[0];
      const filename = 'cover_' + video.id + '_' + Date.now() + '.png';
      const destPath = path.join(__dirname, 'public/uploads', filename);
      require('fs').copyFileSync(srcPath, destPath);
      run(`UPDATE videos SET thumbnail = ? WHERE id = ?`, ['/uploads/' + filename, video.id]);
      res.json({ success: true, thumbnail: '/uploads/' + filename });
    } else {
      res.json({ success: false, error: '生成失败' });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ---- API: 获取某个分类下的子分类 ----
app.get('/api/categories/:id/subcategories', (req, res) => {
  const subs = query(`SELECT * FROM subcategories WHERE category_id = ? ORDER BY sort_order`, [req.params.id]);
  res.json({ subcategories: subs });
});

// 管理员密码修改
app.get('/admin/profile', authMiddleware, (req, res) => {
  res.render('admin/profile', { title: '修改密码 - shangtaopang-可与', admin: req.admin, message: null, error: null });
});

app.post('/admin/profile', authMiddleware, (req, res) => {
  const { old_password, new_password, confirm_password } = req.body;
  const admin = get(`SELECT * FROM admins WHERE id = ?`, [req.admin.id]);

  if (!bcrypt.compareSync(old_password, admin.password_hash)) {
    return res.render('admin/profile', { title: '修改密码 - shangtaopang-可与', admin: req.admin, message: null, error: '原密码错误' });
  }
  if (new_password !== confirm_password) {
    return res.render('admin/profile', { title: '修改密码 - shangtaopang-可与', admin: req.admin, message: null, error: '两次密码不一致' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  run(`UPDATE admins SET password_hash = ? WHERE id = ?`, [hash, req.admin.id]);
  res.render('admin/profile', { title: '修改密码 - shangtaopang-可与', admin: req.admin, message: '密码已修改', error: null });
});

// ---- 留言管理 ----
app.get('/admin/messages', authMiddleware, (req, res) => {
  const messages = query(`SELECT * FROM contact_messages ORDER BY is_read ASC, created_at DESC`);
  res.render('admin/messages', { title: '留言管理 - shangtaopang-可与', admin: req.admin, messages });
});

app.get('/admin/messages/read/:id', authMiddleware, (req, res) => {
  run(`UPDATE contact_messages SET is_read = 1 WHERE id = ?`, [req.params.id]);
  saveDatabase();
  res.redirect('/admin/messages');
});

app.get('/admin/messages/delete/:id', authMiddleware, (req, res) => {
  run(`DELETE FROM contact_messages WHERE id = ?`, [req.params.id]);
  saveDatabase();
  res.redirect('/admin/messages');
});

// ---- 博主管理 ----

// 博主列表
app.get('/admin/bloggers', authMiddleware, (req, res) => {
  const bloggers = query(`SELECT b.*, (SELECT COUNT(*) FROM videos WHERE blogger_id = b.id) as video_count
    FROM bloggers b ORDER BY b.created_at DESC`);
  res.render('admin/bloggers', { title: '博主管理 - shangtaopang-可与', bloggers, admin: req.admin });
});

// 添加博主页
app.get('/admin/bloggers/new', authMiddleware, (req, res) => {
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  const models = cachedQuery(`SELECT * FROM ai_models ORDER BY sort_order`);
  res.render('admin/blogger-form', { title: '添加博主 - shangtaopang-可与', blogger: null, categories, models, admin: req.admin, fetchResult: null });
});

// 编辑博主页
app.get('/admin/bloggers/edit/:id', authMiddleware, (req, res) => {
  const blogger = get(`SELECT * FROM bloggers WHERE id = ?`, [req.params.id]);
  if (!blogger) return res.redirect('/admin/bloggers');
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  const models = cachedQuery(`SELECT * FROM ai_models ORDER BY sort_order`);
  res.render('admin/blogger-form', { title: '编辑博主 - shangtaopang-可与', blogger, categories, models, admin: req.admin, fetchResult: null });
});

// 保存博主
app.post('/admin/bloggers/save', authMiddleware, upload.single('avatar'), (req, res) => {
  const { id, name, slug, platform, platform_user_id, homepage_url, description, bio, featured, status } = req.body;
  let avatar = req.body.current_avatar || '';
  if (req.file) avatar = '/uploads/' + req.file.filename;

  if (id) {
    run(`UPDATE bloggers SET name=?, slug=?, platform=?, platform_user_id=?, homepage_url=?,
      description=?, bio=?, avatar=?, featured=?, status=? WHERE id=?`,
      [name, slug, platform, platform_user_id, homepage_url, description, bio, avatar, featured ? 1 : 0, status || 'active', id]);
  } else {
    run(`INSERT INTO bloggers (name, slug, platform, platform_user_id, homepage_url, description, bio, avatar, featured, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, slug, platform, platform_user_id || null, homepage_url, description, bio, avatar, featured ? 1 : 0, status || 'active']);
  }
  res.redirect('/admin/bloggers');
});

// 删除博主
app.post('/admin/bloggers/delete/:id', authMiddleware, (req, res) => {
  run(`UPDATE videos SET blogger_id = NULL WHERE blogger_id = ?`, [req.params.id]);
  run(`DELETE FROM bloggers WHERE id = ?`, [req.params.id]);
  res.redirect('/admin/bloggers');
});

// ---- 自动抓取 API ----

// 预览抓取结果
app.post('/admin/bloggers/fetch-preview', authMiddleware, async (req, res) => {
  const { url, category_id, ai_model_id } = req.body;
  const result = await fetchVideosFromUrl(url);
  const categories = cachedQuery(`SELECT * FROM categories ORDER BY sort_order`);
  const models = cachedQuery(`SELECT * FROM ai_models ORDER BY sort_order`);

  res.render('admin/blogger-form', {
    title: '抓取结果预览 - shangtaopang-可与',
    blogger: null,
    categories,
    models,
    admin: req.admin,
    fetchResult: result,
    fetchUrl: url,
    defaultCategory: category_id,
    defaultModel: ai_model_id
  });
});

// 确认保存抓取结果
app.post('/admin/bloggers/fetch-save', authMiddleware, async (req, res) => {
  const { url, category_id, ai_model_id, blogger_name, platform, platform_user_id, videos_json } = req.body;

  try {
    const videos = JSON.parse(videos_json);
    if (!videos || videos.length === 0) {
      return res.redirect('/admin/bloggers');
    }

    // 创建或查找博主
    let blogger = get(`SELECT * FROM bloggers WHERE platform_user_id = ? AND platform = ?`, [platform_user_id, platform]);
    const slug = (blogger_name || 'unknown').toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '') + '-' + platform;

    if (!blogger) {
      const bid = run(`INSERT INTO bloggers (name, slug, platform, platform_user_id, homepage_url, description, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [blogger_name || '未知博主', slug, platform, platform_user_id, url, `从${getPlatformName(platform)}自动导入`]);
      blogger = get(`SELECT * FROM bloggers WHERE id = ?`, [bid]);
    }

    // 保存视频
    const saved = saveFetchedVideos(blogger.id, videos, category_id, ai_model_id);
    res.redirect('/admin/bloggers/edit/' + blogger.id + '?saved=' + saved);
  } catch (err) {
    console.error('[Save] 保存失败:', err);
    res.redirect('/admin/bloggers?error=保存失败');
  }
});

// ---- 农历 API ----
const Lunar = require('lunar-javascript');
app.get('/api/lunar', (req, res) => {
  try {
    const now = new Date();
    const solar = Lunar.Solar.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const lunar = solar.getLunar();
    res.json({ date: lunar.getMonth() + '月' + lunar.getDay() + ' · ' + lunar.getYearShengXiao() + '年' });
  } catch(e) { res.json({ date: '--' }); }
});

// ---- 天气 API（代理 wttr.in，缓存10分钟） ----
let weatherCache = { data: null, expires: 0 };
app.get('/api/weather', async (req, res) => {
  // 缓存有效期内直接返回
  if (weatherCache.data && Date.now() < weatherCache.expires) {
    return res.json(weatherCache.data);
  }
  try {
    const https = require('https');
    https.get('https://wttr.in/Ningbo?format=%C|%t|%c&lang=zh', (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        const parts = data.split('|');
        const iconMap = { '☀️':'☀️','🌤':'⛅','⛅':'⛅','🌥':'☁️','☁️':'☁️','🌧':'🌧️','🌦':'🌦️','⛈':'⛈️','❄️':'❄️','🌫':'🌫️','☔':'🌧️' };
        weatherCache.data = {
          desc: (parts[0] || '').trim() || '晴',
          temp: (parts[1] || '').trim().replace('+','') || '--°C',
          icon: iconMap[(parts[2] || '').trim()] || '☀️'
        };
        weatherCache.expires = Date.now() + 600000; // 10分钟
        res.json(weatherCache.data);
      });
    }).on('error', () => { res.json({ desc:'--', temp:'--°C', icon:'☀️' }); });
  } catch(e) { res.json({ desc:'--', temp:'--°C', icon:'☀️' }); }
});

// ---- 全局错误处理 ----
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack || err.message || err);
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(500).json({ error: '服务器内部错误' });
  }
  res.status(500).render('error', {
    title: '服务器错误 - shangtaopang-可与',
    message: process.env.NODE_ENV === 'production' ? '服务器内部错误，请稍后再试' : err.message,
  });
});

// ---- 启动服务器 ----
async function start() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🚀 shangtaopang-可与 已启动！`);
    console.log(`  ─────────────────────────────`);
    console.log(`  🌐 首页: http://localhost:${PORT}`);
    console.log(`  🔐 管理: http://localhost:${PORT}/admin/login`);
    console.log(`  ─────────────────────────────\n`);
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
