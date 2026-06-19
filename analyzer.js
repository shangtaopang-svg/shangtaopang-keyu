/**
 * 庞尚韬AI学习网 - 视频智能分析引擎
 * 根据视频信息自动生成：思维导图、精华速览、模板总结、AI播客、AI学习、文字大纲
 */

// ---- 从标题提取有意义的主题词 ----
function extractTopics(title, description = '') {
  // 提取有意义的短语（英文专有名词、工具名、版本号等）
  const meaningful = [];
  // 匹配英文专用名词/工具名 (Claude Code, ChatGPT, Midjourney等)
  const enMatches = title.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/g) || [];
  enMatches.forEach(m => { const t = m.trim(); if (t.length > 1 && !meaningful.includes(t)) meaningful.push(t); });
  // 匹配中文长词/短语
  const cnMatches = title.match(/[一-鿿]{2,6}/g) || [];
  cnMatches.forEach(m => { if (!meaningful.includes(m)) meaningful.push(m); });
  // 匹配版本号 (V4, 2.0, 2025等)
  const verMatches = title.match(/V?\d+[\.\d]*/g) || [];
  verMatches.forEach(m => { if (!meaningful.includes(m)) meaningful.push(m); });
  return meaningful.slice(0, 8);
}

// ---- 1. 文字大纲（详细版） ----
function generateOutline(title, description = '', categoryName = '') {
  const topics = extractTopics(title, description);
  const cat = categoryName || 'AI学习';
  const lines = [];

  lines.push({ level: 1, text: `📌 ${title}` });
  lines.push({ level: 2, text: '一、课程概览' });
  lines.push({ level: 3, text: `所属分类：${cat}` });
  lines.push({ level: 3, text: `难度建议：${topics.length > 3 ? '进阶' : '入门'}` });
  lines.push({ level: 3, text: `核心主题：${topics.slice(0, 4).join('、') || cat + '相关知识'}` });
  lines.push({ level: 3, text: '学习方式：视频讲解 + 实操演示' });

  lines.push({ level: 2, text: '二、基础入门' });
  lines.push({ level: 3, text: `${topics[0] || cat}是什么？—— 概念与定位` });
  lines.push({ level: 4, text: '核心功能与特点介绍' });
  lines.push({ level: 4, text: '与传统方式的对比优势' });
  lines.push({ level: 4, text: '适用场景分析' });
  lines.push({ level: 3, text: '环境准备与安装' });
  lines.push({ level: 4, text: '所需软硬件要求' });
  lines.push({ level: 4, text: '下载与安装步骤' });
  lines.push({ level: 4, text: '初始化配置说明' });

  lines.push({ level: 2, text: '三、核心功能详解' });
  topics.slice(0, 4).forEach((t, i) => {
    lines.push({ level: 3, text: `${t} 的核心用法` });
    lines.push({ level: 4, text: '基本操作流程' });
    lines.push({ level: 4, text: '进阶使用技巧' });
    lines.push({ level: 4, text: '实际案例演示' });
  });

  lines.push({ level: 2, text: '四、实战案例' });
  lines.push({ level: 3, text: '案例一：基础应用场景' });
  lines.push({ level: 4, text: '需求分析与方案设计' });
  lines.push({ level: 4, text: '具体操作步骤' });
  lines.push({ level: 4, text: '效果验证与优化' });
  lines.push({ level: 3, text: '案例二：进阶应用场景' });
  lines.push({ level: 4, text: '复杂场景应对' });
  lines.push({ level: 4, text: '问题排查与解决' });

  lines.push({ level: 2, text: '五、常见问题与技巧' });
  lines.push({ level: 3, text: '常见错误及解决方案' });
  lines.push({ level: 3, text: '效率提升小技巧' });
  lines.push({ level: 3, text: '最佳实践建议' });

  lines.push({ level: 2, text: '六、总结与拓展' });
  lines.push({ level: 3, text: '本节课重点回顾' });
  lines.push({ level: 3, text: '课后练习建议' });
  lines.push({ level: 3, text: '延伸学习资源推荐' });

  return lines;
}

// ---- 辅助：提取核心主题短语 ----
function extractCorePhrases(topics) {
  if (topics.length === 0) return [{ title: '核心概念', points: ['基础原理', '核心功能'] }];
  return topics.slice(0, 4).map(t => ({
    title: t,
    points: [`${t} 的基础原理`, `${t} 的核心功能`, `${t} 的实践应用`]
  }));
}

// ---- 2. 精华速览（丰富版） ----
function generateHighlights(title, description = '', categoryName = '') {
  const topics = extractTopics(title, description);
  const cat = categoryName || 'AI学习';
  return {
    summary: `《${title}》是一节${cat}领域的教学视频，重点讲解了${topics.slice(0, 3).join('、') || '相关核心知识'}等内容。视频从基础概念入手，结合实操演示，帮助学习者快速掌握核心技能。`,
    keyPoints: [
      ...topics.slice(0, 5).map((t, i) => ({ icon: ['🔥','💡','🎯','⚡','📌'][i] || '📌', text: `${t} — 本节核心${i === 0 ? '（重点掌握）' : '内容'}` })),
      { icon: '💡', text: '实操演示 — 跟着视频动手操作效果更佳' },
      { icon: '⚠️', text: '注意事项 — 留意视频中的常见错误提醒' },
    ],
    qa: [
      { q: `《${title}》适合什么基础的人观看？`, a: `本节属于${cat}领域，内容设计兼顾了不同基础的学习者。新手建议从头观看，有经验者可以重点关注核心功能部分。` },
      { q: `学习${topics[0] || '本节内容'}需要提前准备什么？`, a: `建议准备好电脑/相关软件环境，边看边实践效果最好。视频中通常会介绍所需的环境配置。` },
      { q: `学完本节后能达到什么水平？`, a: `掌握${topics.slice(0, 2).join('和') || '相关知识点'}的核心用法，能够独立完成基础操作，为深入学习打下基础。` },
      { q: `${topics[0] || '本节内容'}和同类工具有什么区别？`, a: `视频中会有对比分析，帮助你理解不同工具/方法的特点和适用场景。` },
    ],
    terms: topics.slice(0, 5).map(t => ({ term: t, def: `${cat}领域的关键概念，本节视频中有详细讲解。` }))
  };
}

// ---- 3. 思维导图数据（深层树状结构） ----
function generateMindMap(title, description = '', categoryName = '') {
  const topics = extractTopics(title, description);
  const cat = categoryName || 'AI学习';

  const root = {
    id: 'root', name: title, expanded: true,
    children: [
      {
        id: 'overview', name: '📌 课程概览', expanded: true,
        children: [
          { id: 'cat', name: `分类: ${cat}`, leaf: true },
          { id: 'topic', name: `主题: ${topics.slice(0, 3).join('、') || cat}`, leaf: true },
          { id: 'level', name: `难度: ${topics.length > 5 ? '进阶' : '入门至进阶'}`, leaf: true },
        ]
      },
      {
        id: 'core', name: '🎯 核心内容', expanded: true,
        children: topics.slice(0, 4).map((t, i) => ({
          id: 'core' + i, name: t, expanded: i === 0,
          children: [
            { id: 'core' + i + '_a', name: `${t} 基础概念`, leaf: true },
            { id: 'core' + i + '_b', name: `${t} 核心用法`, leaf: true },
            { id: 'core' + i + '_c', name: `${t} 实操案例`, leaf: true },
          ]
        }))
      },
      {
        id: 'practice', name: '🔧 实践应用', expanded: false,
        children: [
          { id: 'op1', name: '操作流程', children: [
            { id: 'op1a', name: '环境准备与配置', leaf: true },
            { id: 'op1b', name: '核心操作步骤', leaf: true },
            { id: 'op1c', name: '效果验证与优化', leaf: true },
          ]},
          { id: 'tip', name: '常见注意事项', leaf: true },
          { id: 'tip2', name: '效率提升技巧', leaf: true },
        ]
      },
      {
        id: 'summary', name: '💡 总结提升', expanded: false,
        children: [
          { id: 'gain', name: '本节核心收获', leaf: true },
          { id: 'gap', name: '待深入的知识点', leaf: true },
          { id: 'next', name: '下一步学习建议', leaf: true },
        ]
      }
    ]
  };
  return root;
}

// ---- 4. AI播客脚本 ----
function generatePodcast(title, outline) {
  const topics = outline?.filter(o => o.level === 3).map(o => o.text) || [];
  const mainTopics = topics.slice(0, 4);

  return {
    title: `🎧 ${title} — AI播客`,
    intro: `本期播客为您解读《${title}》，时长约3分钟。`,
    hosts: [
      { name: '小雅', role: 'AI知识主播' },
      { name: '小智', role: 'AI技术主播' }
    ],
    script: [
      { speaker: '小雅', text: `大家好，欢迎收听本期AI播客！今天我们来聊聊《${title}》。` },
      { speaker: '小智', text: `这个话题最近很火啊！${topics[0] || '让我们一起来看看'}，这里面有很多值得探讨的内容。` },
      { speaker: '小雅', text: `没错。我们先从${mainTopics[0] || '核心概念'}开始说起吧。` },
      { speaker: '小智', text: `好的。${mainTopics[1] || '具体来说'}，这部分内容主要讲的是...(建议边看视频边完善)）` },
      { speaker: '小雅', text: `那${mainTopics[2] || '实际应用'}方面呢？有什么亮点？` },
      { speaker: '小智', text: `这里有几个很实用的技巧...(建议记录视频中的具体案例)）` },
      { speaker: '小雅', text: `总结一下，今天的核心收获就是理解${topics.slice(0, 2).join('和') || '这些知识点'}。` },
      { speaker: '小智', text: `没错！感谢收听，我们下期再见！` },
    ]
  };
}

// ---- 5. AI学习（测试题 & 学习路径 & 推荐内容） ----
function generateLearning(title, categoryName = '') {
  const cat = categoryName || 'AI';
  return {
    summary: `通过本节课的学习，你将掌握${cat}领域的核心知识与实践技能。建议按照学习路径逐步深入。`,
    quiz: [
      { q: `本节课《${title}》主要讲述了什么内容？`, options: ['A. ' + cat + '的基础概念与原理', 'B. ' + cat + '的高级应用技巧', 'C. ' + cat + '的相关工具与实操', 'D. 以上都涵盖'], answer: 3, explain: `视频内容通常从基础概念到实践应用都有覆盖。` },
      { q: `学习完后，你认为${cat}最吸引你的地方是什么？`, type: 'open', answer: '', explain: '请记录你的个人感悟。' },
      { q: `你打算如何将本节课学到的知识应用到实际中？`, type: 'open', answer: '', explain: '思考实践场景，有助于知识内化。' },
    ],
    learningPath: [
      { step: 1, title: `了解${cat}基础`, description: '掌握核心概念与术语', time: '10分钟' },
      { step: 2, title: '观看视频演示', description: '跟随讲解理解操作流程', time: '视频时长' },
      { step: 3, title: '动手实践', description: '尝试自己操作一遍', time: '20分钟' },
      { step: 4, title: '总结复盘', description: '记录学习笔记与心得', time: '10分钟' },
      { step: 5, title: '拓展学习', description: '探索相关进阶内容', time: '自由安排' },
    ],
    relatedTopics: [`${cat}入门指南`, `${cat}进阶技巧`, `${cat}工具推荐`, `${cat}实战案例`, `${cat}常见问题`],
    tips: `建议先完整观看一遍视频，第二遍时暂停做笔记，效果更佳。`
  };
}

// ---- 6. 模板总结 ----
function generateTemplateSummary(title, categoryName = '') {
  return {
    title: '📋 视频学习总结模板',
    sections: [
      { label: '📌 视频标题', content: title },
      { label: '📂 所属分类', content: categoryName || '未分类' },
      { label: '🎯 学习目标', content: '请填写本节课的学习目标' },
      { label: '📖 核心内容', content: '请记录视频中讲解的核心知识点' },
      { label: '💡 重点难点', content: '请标注你认为的重点和难点' },
      { label: '🔧 实践应用', content: '这些知识如何应用到实际中？' },
      { label: '❓ 疑问待解', content: '记录你还有疑问的地方' },
      { label: '📝 学习感悟', content: '写下你的整体学习感受' },
    ]
  };
}

// ---- 主入口：生成完整分析 ----
function generateFullAnalysis(video) {
  if (!video) return null;
  const title = video.title || '';
  const desc = video.description || '';
  const cat = video.category_name || '';

  const outline = generateOutline(title, desc, cat);
  const highlights = generateHighlights(title, desc, cat);
  const mindmap = generateMindMap(title, desc, cat);
  const podcast = generatePodcast(title, outline);
  const learning = generateLearning(title, cat);
  const template = generateTemplateSummary(title, cat);

  return {
    outline,
    highlights,
    mindmap,
    podcast,
    learning,
    template,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { generateFullAnalysis, generateOutline, generateHighlights, generateMindMap, generatePodcast, generateLearning, generateTemplateSummary };
