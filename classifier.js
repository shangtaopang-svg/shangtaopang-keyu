/**
 * 庞尚韬AI学习网 - 视频自动分类引擎
 * 根据视频标题/描述自动匹配分类和AI模型
 */
const { query } = require('./database');

// ---- 关键词 → 分类映射 ----
const CATEGORY_KEYWORDS = [
  { id: 1,  slug: 'ai-tools',    keywords: ['chatgpt','claude','gemini','kimi','豆包','通义千问','deepseek','教程','使用','指南','入门','上手','技巧','玩法','介绍','实操','教学'] },
  { id: 2,  slug: 'ai-art',      keywords: ['midjourney','stable diffusion','dall-e','dalle','绘画','设计','生图','作图','ai画','ai设计','创意','插画','海报'] },
  { id: 3,  slug: 'ai-coding',   keywords: ['cursor','copilot','windsurf','编程','代码','开发','程序员','前端','后端','python','写代码','devin','agent','程序','debug'] },
  { id: 4,  slug: 'ai-video',    keywords: ['sora','可灵','kling','runway','pika','视频生成','文生视频','ai视频','视频制作','剪辑','ai电影'] },
  { id: 5,  slug: 'ai-office',   keywords: ['excel','ppt','word','办公','效率','自动化','文档','表格','幻灯片','wps'] },
  { id: 6,  slug: 'ai-trends',   keywords: ['趋势','分析','报告','未来','深度','行业','前景','预测','新闻','发布','财报','融资'] },
  { id: 7,  slug: 'ai-audio',    keywords: ['语音','音乐','音频','配音','克隆','suno','udio','elevenlabs','音色','歌曲','作词'] },
  { id: 8,  slug: 'ai-basics',   keywords: ['科普','扫盲','基础','入门','什么是','ai是什么','人工智能','概念','原理','本质'] },
];

// ---- 关键词 → AI模型映射 ----
const MODEL_KEYWORDS = [
  { id: 1,  slug: 'chatgpt',         keywords: ['chatgpt','gpt-4','gpt4','openai','gpt-4o','chat gpt','gpt4o','o1','o3'] },
  { id: 2,  slug: 'claude',           keywords: ['claude','anthropic','claude code','claude ai'] },
  { id: 3,  slug: 'gemini',           keywords: ['gemini','google ai','bard','gemini pro'] },
  { id: 4,  slug: 'midjourney',       keywords: ['midjourney','mj','mid-journey'] },
  { id: 5,  slug: 'stable-diffusion', keywords: ['stable diffusion','sd','comfyui','a1111','stable-diffusion'] },
  { id: 6,  slug: 'dalle',            keywords: ['dall-e','dalle','dall e'] },
  { id: 7,  slug: 'cursor',           keywords: ['cursor','cursor ai'] },
  { id: 8,  slug: 'copilot',          keywords: ['copilot','github copilot','gpt-4o copilot'] },
  { id: 9,  slug: 'kling',            keywords: ['可灵','kling'] },
  { id: 10, slug: 'sora',             keywords: ['sora','openai sora'] },
  { id: 11, slug: 'runway',           keywords: ['runway','runwayml','gen-2','gen-3'] },
  { id: 12, slug: 'kimi',             keywords: ['kimi','月之暗面','moonshot'] },
  { id: 13, slug: 'tongyi',           keywords: ['通义千问','通义','千问'] },
  { id: 14, slug: 'deepseek',         keywords: ['deepseek','deep seek','深度求索'] },
  { id: 15, slug: 'doubao',           keywords: ['豆包','doubao','字节豆包'] },
];

// ---- 关键词 → 子分类映射 ----
const SUBCATEGORY_KEYWORDS = [
  // AI 工具教程
  { slug: 'chatgpt', catId: 1, keywords: ['chatgpt','gpt-4','gpt4o','gpt4','openai','o1','o3','chat gpt'] },
  { slug: 'claude', catId: 1, keywords: ['claude','anthropic','claude ai'] },
  { slug: 'claude-code', catId: 1, keywords: ['claude code','claude-code'] },
  { slug: 'gemini', catId: 1, keywords: ['gemini','google ai','bard'] },
  { slug: 'deepseek', catId: 1, keywords: ['deepseek','deep seek'] },
  { slug: 'kimi', catId: 1, keywords: ['kimi','月之暗面','moonshot'] },
  { slug: 'doubao', catId: 1, keywords: ['豆包','doubao'] },
  { slug: 'tongyi', catId: 1, keywords: ['通义千问','通义','千问'] },
  { slug: 'coze', catId: 1, keywords: ['coze','扣子'] },
  { slug: 'dify', catId: 1, keywords: ['dify'] },
  { slug: 'open-claw', catId: 1, keywords: ['openclaw','open claw','qclaw'] },
  { slug: 'codex', catId: 1, keywords: ['codex'] },
  { slug: 'chatgpt', catId: 1, keywords: ['gpt5','gpt-5','gpt4o','gpt-4o'] },
  { slug: 'perplexity', catId: 1, keywords: ['perplexity'] },
  { slug: 'grok', catId: 1, keywords: ['grok','xai'] },
  // AI 绘画
  { slug: 'midjourney', catId: 2, keywords: ['midjourney','mj','mid-journey'] },
  { slug: 'stable-diffusion', catId: 2, keywords: ['stable diffusion','sd','comfyui','a1111'] },
  { slug: 'dalle', catId: 2, keywords: ['dall-e','dalle','dall e'] },
  { slug: 'comfyui', catId: 2, keywords: ['comfyui'] },
  { slug: 'leonardo', catId: 2, keywords: ['leonardo'] },
  // AI 编程
  { slug: 'cursor', catId: 3, keywords: ['cursor','cursor ai'] },
  { slug: 'copilot', catId: 3, keywords: ['copilot','github copilot'] },
  { slug: 'windsurf', catId: 3, keywords: ['windsurf'] },
  { slug: 'devin', catId: 3, keywords: ['devin'] },
  { slug: 'bolt', catId: 3, keywords: ['bolt.new','bolt'] },
  { slug: 'v0', catId: 3, keywords: ['v0'] },
  // AI 视频
  { slug: 'kling', catId: 4, keywords: ['可灵','kling'] },
  { slug: 'sora', catId: 4, keywords: ['sora'] },
  { slug: 'runway', catId: 4, keywords: ['runway','gen-2','gen-3'] },
  { slug: 'pika', catId: 4, keywords: ['pika'] },
  { slug: 'heygen', catId: 4, keywords: ['heygen'] },
  // AI 办公
  { slug: 'gamma', catId: 5, keywords: ['gamma'] },
  { slug: 'notion-ai', catId: 5, keywords: ['notion'] },
  // AI 音频
  { slug: 'suno', catId: 7, keywords: ['suno'] },
  { slug: 'udio', catId: 7, keywords: ['udio'] },
  { slug: 'elevenlabs', catId: 7, keywords: ['elevenlabs','eleven'] },
  { slug: 'fish-audio', catId: 7, keywords: ['fish audio','fish-audio'] },
  // 通用分类映射（无具体工具时）
  { slug: 'beginner-guide', catId: 8, keywords: ['入门','小白','科普','扫盲','基础'] },
  { slug: 'industry-analysis', catId: 6, keywords: ['趋势','分析','报告','未来','深度','行业','失业','就业','诺贝尔'] },
  { slug: 'deep-dive', catId: 6, keywords: ['万字','揭秘','深度解读'] },
  { slug: 'basic-concepts', catId: 8, keywords: ['什么是','ai是什么','人工智能','概念','原理'] },
  { slug: 'ai-video', catId: 4, keywords: ['ai视频','ai电影','mv','ai作曲'] },
  { slug: 'jianying', catId: 4, keywords: ['剪映','剪辑'] },
  { slug: 'suno', catId: 7, keywords: ['作曲','作词','音乐','歌曲'] },
  { slug: 'dalle', catId: 2, keywords: ['ai绘画','ai画','绘画','设计','p图','作图'] },
  { slug: 'agent', catId: 3, keywords: ['agent','智能体','n8n'] },
  { slug: 'feishu-ai', catId: 5, keywords: ['飞书'] },
  { slug: 'dalle', catId: 2, keywords: ['gpt image','gpt image 2'] },
  { slug: 'tool-recommend', catId: 8, keywords: ['推荐','好东西','工具','省钱'] },
];

// ---- 分类视频标题 ----
function classifyVideo(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();

  // 匹配分类
  let categoryId = null;
  let maxScore = 0;
  for (const cat of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (text.includes(kw)) score += kw.length;
    }
    if (score > maxScore) {
      maxScore = score;
      categoryId = cat.id;
    }
  }

  // 匹配AI模型
  let modelId = null;
  let modelMaxScore = 0;
  for (const m of MODEL_KEYWORDS) {
    let score = 0;
    for (const kw of m.keywords) {
      if (text.includes(kw)) score += kw.length;
    }
    if (score > modelMaxScore) {
      modelMaxScore = score;
      modelId = m.id;
    }
  }

  // 匹配子分类
  let subcategorySlug = null;
  let subMaxScore = 0;
  for (const sc of SUBCATEGORY_KEYWORDS) {
    let score = 0;
    for (const kw of sc.keywords) {
      if (text.includes(kw)) score += kw.length * 2;
    }
    if (score > subMaxScore) {
      subMaxScore = score;
      subcategorySlug = sc.slug;
    }
  }

  return { categoryId, modelId, subcategorySlug };
}

// ---- 批量分类并保存到数据库 ----
function classifyAndUpdateVideos(videoIds = null) {
  const { run } = require('./database');
  const videos = videoIds
    ? query(`SELECT id, title, description, category_id, ai_model_id, subcategory_id FROM videos WHERE id IN (${videoIds.map(() => '?').join(',')})`, videoIds)
    : query(`SELECT id, title, description, category_id, ai_model_id, subcategory_id FROM videos`);

  let updated = 0;
  for (const v of videos) {
    const { categoryId, modelId, subcategorySlug } = classifyVideo(v.title, v.description || '');
    const updates = [];
    const params = [];

    if (categoryId) {
      updates.push('category_id = ?');
      params.push(categoryId);
    }
    if (modelId) {
      updates.push('ai_model_id = ?');
      params.push(modelId);
    }
    if (subcategorySlug) {
      // 查询子分类ID
      const sub = query(`SELECT id FROM subcategories WHERE slug = ?`, [subcategorySlug]);
      if (sub.length > 0) {
        updates.push('subcategory_id = ?');
        params.push(sub[0].id);
      }
    }

    if (updates.length > 0) {
      run(`UPDATE videos SET ${updates.join(', ')} WHERE id = ?`, [...params, v.id]);
      updated++;
    }
  }
  return updated;
}

module.exports = { classifyVideo, classifyAndUpdateVideos };
