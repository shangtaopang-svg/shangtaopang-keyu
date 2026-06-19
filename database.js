const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.db');

let db = null;
let SQL = null;

async function initDatabase() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('[DB] 已加载现有数据库');
  } else {
    db = new SQL.Database();
    console.log('[DB] 创建新数据库');
  }

  // 启用外键
  db.run('PRAGMA foreign_keys = ON');

  createTables();
  seedData();

  saveDatabase();
  return db;
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT DEFAULT '📚',
      description TEXT,
      color TEXT DEFAULT '#6366f1',
      sort_order INTEGER DEFAULT 0,
      video_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT DEFAULT '🤖',
      company TEXT,
      description TEXT,
      color TEXT DEFAULT '#8b5cf6',
      sort_order INTEGER DEFAULT 0,
      video_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      url TEXT,
      embed_code TEXT,
      embed_type TEXT DEFAULT 'iframe',
      platform TEXT,
      category_id INTEGER REFERENCES categories(id),
      ai_model_id INTEGER REFERENCES ai_models(id),
      tags TEXT,
      thumbnail TEXT,
      duration TEXT,
      source_author TEXT,
      source_link TEXT,
      featured INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      status TEXT DEFAULT 'published',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bloggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      avatar TEXT,
      platform TEXT NOT NULL DEFAULT 'other',
      platform_user_id TEXT,
      homepage_url TEXT,
      description TEXT,
      bio TEXT,
      follower_count INTEGER DEFAULT 0,
      video_count INTEGER DEFAULT 0,
      featured INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      last_sync_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS subcategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES categories(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      icon TEXT DEFAULT '📎',
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      video_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(category_id, slug)
    )
  `);

  // 检查 videos 表是否有 blogger_id / subcategory_id 列
  const tableInfo = db.exec(`PRAGMA table_info(videos)`);
  const columns = tableInfo[0]?.values.map(v => v[1]) || [];
  if (!columns.includes('blogger_id')) {
    db.run(`ALTER TABLE videos ADD COLUMN blogger_id INTEGER REFERENCES bloggers(id)`);
  }
  if (!columns.includes('subcategory_id')) {
    db.run(`ALTER TABLE videos ADD COLUMN subcategory_id INTEGER REFERENCES subcategories(id)`);
  }

  // 创建索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_videos_ai_model ON videos(ai_model_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_videos_platform ON videos(platform)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_videos_featured ON videos(featured)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_videos_blogger ON videos(blogger_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bloggers_platform ON bloggers(platform)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bloggers_featured ON bloggers(featured)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS learning_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER REFERENCES videos(id),
      title TEXT NOT NULL,
      summary TEXT,
      content TEXT,
      key_points TEXT,
      status TEXT DEFAULT 'planned',
      rating INTEGER DEFAULT 0,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notes_video ON learning_notes(video_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notes_status ON learning_notes(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_subcategories_category ON subcategories(category_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_videos_subcategory ON videos(subcategory_id)`);

  // 收藏表
  db.run(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER REFERENCES videos(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(video_id)
    )
  `);

  // 学习打卡表
  db.run(`
    CREATE TABLE IF NOT EXISTS study_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkin_date TEXT NOT NULL UNIQUE,
      note_count INTEGER DEFAULT 0,
      video_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_checkins_date ON study_checkins(checkin_date)`);

  // 相册表
  db.run(`
    CREATE TABLE IF NOT EXISTS photo_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      cover TEXT,
      year TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // 照片表
  db.run(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER REFERENCES photo_albums(id),
      filename TEXT NOT NULL,
      original_name TEXT,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id)`);

  // 出行记录表
  db.run(`
    CREATE TABLE IF NOT EXISTS travel_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      purpose TEXT,
      transport TEXT DEFAULT 'train',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 留言表
  db.run(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 检查learning_notes是否有analysis_data列
  const notesInfo = db.exec(`PRAGMA table_info(learning_notes)`);
  const noteColumns = notesInfo[0]?.values.map(v => v[1]) || [];
  if (!noteColumns.includes('analysis_data')) {
    db.run(`ALTER TABLE learning_notes ADD COLUMN analysis_data TEXT`);
  }
}

function seedData() {
  // 检查是否已有数据
  const count = db.exec(`SELECT COUNT(*) as c FROM categories`);
  if (count[0]?.values[0][0] > 0) return;

  console.log('[DB] 插入种子数据...');

  // 默认分类
  const categories = [
    ['AI 工具教程', 'ai-tools', '🛠️', 'ChatGPT、Claude、Kimi、豆包等AI工具使用教程', '#3b82f6', 1],
    ['AI 绘画/设计', 'ai-art', '🎨', 'Midjourney、Stable Diffusion、DALL-E 等AI绘画设计', '#ec4899', 2],
    ['AI 编程', 'ai-coding', '💻', 'Cursor、Copilot、Windsurf 等AI编程辅助工具', '#10b981', 3],
    ['AI 视频生成', 'ai-video', '🎬', 'Sora、可灵、Runway、Pika 等AI视频生成', '#f59e0b', 4],
    ['AI 办公', 'ai-office', '📊', 'AI + Excel、PPT、Word 办公效率提升', '#8b5cf6', 5],
    ['AI 行业趋势', 'ai-trends', '📈', 'AI最新动态、深度分析、行业报告', '#ef4444', 6],
    ['AI 音频/音乐', 'ai-audio', '🎵', 'AI语音合成、音乐生成、配音克隆', '#06b6d4', 7],
    ['AI 科普入门', 'ai-basics', '🧠', 'AI基础概念、扫盲科普、入门指南', '#84cc16', 8],
  ];

  const stmt1 = db.prepare(`INSERT INTO categories (name, slug, icon, description, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const c of categories) stmt1.run(c);
  stmt1.free();

  // 默认子分类
  const subcategories = [
    // AI 工具教程 (cat_id=1)
    [1, 'ChatGPT', 'chatgpt', '💬', 'OpenAI 聊天机器人', 1],
    [1, 'Claude', 'claude', '🧠', 'Anthropic AI 助手', 2],
    [1, 'Claude Code', 'claude-code', '⌨️', 'Claude 编程工具', 3],
    [1, 'Gemini', 'gemini', '🌟', 'Google AI 模型', 4],
    [1, 'DeepSeek', 'deepseek', '🔍', '深度求索 AI', 5],
    [1, 'Kimi', 'kimi', '📖', '月之暗面 AI', 6],
    [1, '豆包', 'doubao', '🫘', '字节跳动 AI助手', 7],
    [1, '通义千问', 'tongyi', '☁️', '阿里云 AI', 8],
    [1, 'Coze', 'coze', '🧩', '字节跳动 AI Bot平台', 9],
    [1, 'Dify', 'dify', '🔧', '开源 LLM 应用平台', 10],
    [1, 'Open Claw', 'open-claw', '🦀', 'AI 自动化工具', 11],
    [1, 'Hermes', 'hermes', '⚡', 'AI 通用工具', 12],
    [1, 'Codex', 'codex', '📝', 'AI 代码生成', 13],
    [1, 'Work Buddy', 'work-buddy', '🤝', 'AI 工作助手', 14],
    [1, 'Trae', 'trae', '🚀', 'AI 效率工具', 15],
    [1, 'Perplexity', 'perplexity', '🌐', 'AI 搜索引擎', 16],
    [1, 'Grok', 'grok', '💎', 'xAI 对话模型', 17],
    // AI 绘画/设计 (cat_id=2)
    [2, 'Midjourney', 'midjourney', '🎨', 'AI 绘画工具', 1],
    [2, 'Stable Diffusion', 'stable-diffusion', '🖼️', '开源 AI 绘画', 2],
    [2, 'DALL-E', 'dalle', '✨', 'OpenAI 图像生成', 3],
    [2, 'ComfyUI', 'comfyui', '🔌', 'SD 节点式 UI', 4],
    [2, 'Fooocus', 'fooocus', '🎯', 'SD 简化版', 5],
    [2, 'Leonardo', 'leonardo', '🎭', 'AI 绘画平台', 6],
    [2, 'Canva AI', 'canva-ai', '📐', '设计工具 AI', 7],
    [2, 'Adobe Firefly', 'firefly', '🔥', 'Adobe AI 设计', 8],
    [2, 'Ideogram', 'ideogram', '🅰️', 'AI 文字生图', 9],
    [2, 'Recraft', 'recraft', '🎪', 'AI 矢量设计', 10],
    // AI 编程 (cat_id=3)
    [3, 'Cursor', 'cursor', '⌨️', 'AI 代码编辑器', 1],
    [3, 'GitHub Copilot', 'copilot', '🤖', 'GitHub AI 编程', 2],
    [3, 'Windsurf', 'windsurf', '🏄', 'AI IDE', 3],
    [3, 'Devin', 'devin', '👨‍💻', 'AI 软件工程师', 4],
    [3, 'Replit', 'replit', '🌐', '在线 IDE + AI', 5],
    [3, 'Bolt', 'bolt', '⚡', 'AI 全栈开发', 6],
    [3, 'Lovable', 'lovable', '💖', 'AI 应用构建', 7],
    [3, 'v0', 'v0', '✂️', 'Vercel AI UI 生成', 8],
    [3, 'Claude Code', 'claude-code-dev', '🧠', 'Claude 编程', 9],
    [3, 'CodeGPT', 'codegpt', '💻', 'VS Code AI 插件', 10],
    // AI 视频生成 (cat_id=4)
    [4, 'Sora', 'sora', '🎬', 'OpenAI 文生视频', 1],
    [4, '可灵（Kling）', 'kling', '🎥', '快手 AI 视频', 2],
    [4, 'Runway', 'runway', '🎞️', 'AI 视频编辑', 3],
    [4, 'Pika', 'pika', '🫎', 'AI 视频生成', 4],
    [4, '剪映 AI', 'jianying', '✂️', '剪映 AI 功能', 5],
    [4, 'CapCut', 'capcut', '🎪', '剪映国际版 AI', 6],
    [4, 'HeyGen', 'heygen', '👤', 'AI 数字人视频', 7],
    [4, 'Vidu', 'vidu', '🎭', 'AI 视频生成', 8],
    [4, 'Luma', 'luma', '🌊', 'AI 3D/视频', 9],
    // AI 办公 (cat_id=5)
    [5, 'Excel AI', 'excel-ai', '📊', 'AI + 表格', 1],
    [5, 'PPT AI', 'ppt-ai', '📽️', 'AI 生成 PPT', 2],
    [5, 'Word AI', 'word-ai', '📝', 'AI + 文档', 3],
    [5, 'WPS AI', 'wps-ai', '📄', 'WPS AI 功能', 4],
    [5, 'Gamma', 'gamma', '✨', 'AI PPT 工具', 5],
    [5, 'Beautiful AI', 'beautiful-ai', '🎯', 'AI 演示制作', 6],
    [5, 'Notion AI', 'notion-ai', '📋', 'Notion AI 笔记', 7],
    [5, '飞书 AI', 'feishu-ai', '📎', '飞书智能伙伴', 8],
    // AI 行业趋势 (cat_id=6)
    [6, '行业分析', 'industry-analysis', '📈', 'AI 行业报告', 1],
    [6, '新品发布', 'product-launch', '🚀', 'AI 产品发布', 2],
    [6, '深度解读', 'deep-dive', '🔬', 'AI 深度分析', 3],
    [6, '政策法规', 'policy', '⚖️', 'AI 监管政策', 4],
    [6, '投融资', 'investment', '💰', 'AI 投资动态', 5],
    // AI 音频/音乐 (cat_id=7)
    [7, 'Suno', 'suno', '🎵', 'AI 音乐生成', 1],
    [7, 'Udio', 'udio', '🎶', 'AI 音乐创作', 2],
    [7, 'ElevenLabs', 'elevenlabs', '🗣️', 'AI 语音合成', 3],
    [7, 'Fish Audio', 'fish-audio', '🐟', 'AI 语音克隆', 4],
    [7, 'GPT-SoVITS', 'gpt-sovits', '🔊', 'AI 语音合成', 5],
    // AI 科普入门 (cat_id=8)
    [8, 'AI 基础概念', 'basic-concepts', '📚', 'AI 术语解释', 1],
    [8, '入门教程', 'beginner-guide', '🎒', 'AI 入门指南', 2],
    [8, '工具推荐', 'tool-recommend', '⭐', 'AI 工具推荐', 3],
    [8, '学习路径', 'learning-path', '🗺️', 'AI 学习规划', 4],
  ];

  const stmtSc = db.prepare(`INSERT OR IGNORE INTO subcategories (category_id, name, slug, icon, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const s of subcategories) stmtSc.run(s);
  stmtSc.free();

  // 默认AI模型
  const models = [
    ['ChatGPT', 'chatgpt', '💬', 'OpenAI', 'OpenAI 的大语言模型，对话式AI助手', '#10a37f', 1],
    ['Claude', 'claude', '🧠', 'Anthropic', 'Anthropic 的 AI 助手，擅长长文本和深度分析', '#d97706', 2],
    ['Gemini', 'gemini', '🌟', 'Google', 'Google 的多模态AI模型', '#4285f4', 3],
    ['Midjourney', 'midjourney', '🎨', 'Midjourney', 'AI 绘画工具，以艺术风格著称', '#ff4500', 4],
    ['Stable Diffusion', 'stable-diffusion', '🖼️', 'Stability AI', '开源AI 绘画模型，可本地部署', '#7c3aed', 5],
    ['DALL-E', 'dalle', '✨', 'OpenAI', 'OpenAI 的图像生成模型', '#6366f1', 6],
    ['Cursor', 'cursor', '⌨️', 'Cursor', 'AI 代码编辑器，深度集成AI辅助', '#6ee7b7', 7],
    ['GitHub Copilot', 'copilot', '🤖', 'GitHub', 'GitHub 的 AI 编程助手', '#8957e5', 8],
    ['可灵（Kling）', 'kling', '🎥', '快手', '快手AI视频生成工具', '#ff6b35', 9],
    ['Sora', 'sora', '🎬', 'OpenAI', 'OpenAI 文生视频模型', '#1a1a2e', 10],
    ['Runway', 'runway', '🎞️', 'Runway', 'AI视频编辑与生成工具', '#0d0d0d', 11],
    ['Kimi', 'kimi', '📖', '月之暗面', 'Moonshot AI，支持超长上下文', '#f472b6', 12],
    ['通义千问', 'tongyi', '☁️', '阿里巴巴', '阿里云AI大模型', '#1677ff', 13],
    ['DeepSeek', 'deepseek', '🔍', '深度求索', '国产开源大语言模型', '#4f46e5', 14],
    ['豆包', 'doubao', '🫘', '字节跳动', '字节跳动 AI 助手', '#2563eb', 15],
  ];

  const stmt2 = db.prepare(`INSERT INTO ai_models (name, slug, icon, company, description, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const m of models) stmt2.run(m);
  stmt2.free();

  // 创建默认管理员 (用户名: admin, 密码: admin123)
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT INTO admins (username, password_hash) VALUES (?, ?)`, ['admin', hash]);
}

// 防抖：避免频繁写磁盘，多个写操作合并为一次写入
let _saveTimer = null;
function saveDatabase() {
  if (!db) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      console.error('[DB] 写入失败:', e.message);
    }
  }, 300);
}

// 立即同步写入（用于关闭前保证数据落盘）
function flushDatabase() {
  if (!db) return;
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error('[DB] 同步写入失败:', e.message);
  }
}

// 进程退出前刷盘
process.on('SIGTERM', () => { flushDatabase(); });
process.on('SIGINT', () => { flushDatabase(); });

// ---- 查询方法 ----

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function isValidTable(name) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
  // 使用查询获取最后插入的ID（通过查找对应表的最大ID）
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith('INSERT')) {
    let table = '';
    const m = sql.match(/INSERT\s+INTO\s+(\w+)/i);
    if (m) table = m[1];
    if (table && isValidTable(table)) {
      const r = db.exec(`SELECT seq FROM sqlite_sequence WHERE name = '${table}'`);
      if (r[0]?.values[0][0]) return r[0].values[0][0];
    }
    return db.exec(`SELECT last_insert_rowid() as id`)[0]?.values[0][0];
  }
  return null;
}

function exec(sql) {
  db.exec(sql);
  saveDatabase();
}

module.exports = { initDatabase, query, get, run, exec, saveDatabase, flushDatabase };
