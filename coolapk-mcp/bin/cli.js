#!/usr/bin/env node
/**
 * 酷安 API CLI
 *
 * 用法:
 *   coolapk search <关键词> [--type feed|user|app] [--page N] [--pages N] [--since 7d]
 *   coolapk feed <id>
 *   coolapk replies <id> [--page N] [--pages N] [--sort hot|new] [--sentiment]
 *   coolapk user <uid>
 *   coolapk index [--page N]
 *   coolapk topic <tag>
 *   coolapk hot                        酷安热榜
 *   coolapk batch <词1> <词2> ...      多关键词批量搜索 + 合并去重
 *   coolapk report <关键词>            一键报告（搜索+评论+情感+词频）
 *
 * 通用选项:
 *   --json          输出 JSON 格式
 *   --pages N       批量获取 N 页
 *   --since Nd      只显示 N 天内的结果
 *   --sentiment     对评论做情感分析标注
 *   --no-color      禁用颜色
 */

const CoolapkAPI = require('../src/index');
const api = new CoolapkAPI();

const [,, cmd, ...rawArgs] = process.argv;

// --- 参数解析 ---

function getOpt(name, def) {
  const i = rawArgs.indexOf('--' + name);
  if (i < 0) return def;
  if (['json', 'no-color', 'sentiment'].includes(name)) return true;
  return rawArgs[i + 1] || def;
}

function getPositional() {
  const result = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith('--')) {
      if (!['--json', '--no-color', '--sentiment'].includes(rawArgs[i])) i++; // skip value
      continue;
    }
    result.push(rawArgs[i]);
  }
  return result;
}

const JSON_MODE = getOpt('json', false);
const NO_COLOR = getOpt('no-color', false) || !process.stdout.isTTY;
const SENTIMENT = getOpt('sentiment', false);

// --- 格式化工具 ---

function c(code, text) { if (NO_COLOR) return text; return `\x1b[${code}m${text}\x1b[0m`; }
function dim(s) { return c('2', s); }
function bold(s) { return c('1', s); }
function red(s) { return c('31', s); }
function green(s) { return c('32', s); }
function yellow(s) { return c('33', s); }
function cyan(s) { return c('36', s); }
function magenta(s) { return c('35', s); }

function stripHtml(s) {
  return (s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .trim();
}

function truncate(s, max) { if (!s || s.length <= max) return s; return s.substring(0, max) + '…'; }

function timeAgo(ts) {
  if (!ts) return '';
  const sec = Math.floor(Date.now() / 1000) - ts;
  if (sec < 60) return '刚刚';
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}天前`;
  const d = new Date(ts * 1000);
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function parseSince(val) {
  if (!val) return 0;
  const m = val.match(/^(\d+)d$/);
  if (m) return Math.floor(Date.now() / 1000) - parseInt(m[1]) * 86400;
  // 尝试解析日期
  const d = Date.parse(val);
  if (!isNaN(d)) return Math.floor(d / 1000);
  return 0;
}

function filterBySince(items, sinceTs) {
  if (!sinceTs) return items;
  return items.filter(item => (item.dateline || item.lastupdate || 0) >= sinceTs);
}

// --- 情感分析 ---

let sentimentReady = false;
let analyzeBatch = null;

async function loadSentiment() {
  if (sentimentReady) return;
  try {
    const mod = await import('../src/sentiment.mjs');
    if (!mod.isAvailable()) {
      process.stderr.write(dim(`💡 情感分析未安装。运行 npm run install-sentiment 启用此功能。\n`));
      return;
    }
    await mod.init();
    analyzeBatch = mod.analyzeBatch;
    sentimentReady = true;
  } catch (e) {
    process.stderr.write(dim(`情感分析不可用: ${e.message}\n`));
  }
}

function sentimentLabel(score) {
  if (score > 0.6) return green('👍正面');
  if (score < 0.4) return red('👎负面');
  return dim('😐中性');
}

// --- 词频分析 ---

function wordFreq(texts, topN = 20) {
  // 简单分词：中文按字符 bigram + 单词，英文按空格
  const freq = {};
  const stopWords = new Set(['的','了','是','在','我','有','和','就','不','人','都','一','这','中','大','为','上','个','到','说','会','要','也','用','能','还','可以','没有','他','很','但','那','你','吧','啊','嘛','呢','哈','哈哈','真的','可以','什么','一个','不是','这个','没有','就是','的话']);

  for (const text of texts) {
    const clean = stripHtml(text).replace(/[\[\]【】「」『』（）\(\).,。，！？!?、:：;；"'""''\\/@#$%^&*+=<>{}|~`\-_…\d\s]/g, ' ');
    // 中文 bigram
    const chars = [...clean.replace(/[a-zA-Z\s]+/g, ' ')].filter(c => c.trim());
    for (let i = 0; i < chars.length - 1; i++) {
      const w = chars[i] + chars[i+1];
      if (!stopWords.has(w) && w.trim().length === 2) freq[w] = (freq[w] || 0) + 1;
    }
    // 英文单词
    const words = clean.match(/[a-zA-Z]{2,}/g) || [];
    for (const w of words) {
      const lw = w.toLowerCase();
      if (!stopWords.has(lw) && lw.length > 2) freq[lw] = (freq[lw] || 0) + 1;
    }
  }

  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, topN);
}

// --- 命令实现 ---

async function cmdSearch() {
  const q = getPositional()[0];
  if (!q) { console.log('用法: coolapk search <关键词> [--pages N] [--since 7d]'); return; }

  const type = getOpt('type', 'feed');
  const pages = parseInt(getOpt('pages', '1'));
  const page = parseInt(getOpt('page', '1'));
  const since = parseSince(getOpt('since', null));

  let data;
  if (pages > 1) {
    data = await api.searchAll(q, { type, maxPages: Math.min(pages, 10) });
  } else {
    data = await api.search(q, type, page);
  }
  data = filterBySince(data, since);

  if (JSON_MODE) { console.log(JSON.stringify(data, null, 2)); return; }

  console.log(`${bold(`搜索 "${q}"`)} · ${data.length} 条结果${pages > 1 ? ` (${pages}页)` : ''}${since ? ' (已过滤时间)' : ''}\n`);
  data.forEach((item, i) => {
    const msg = truncate(stripHtml(item.message_title || item.message || item.title || ''), 100);
    const author = cyan(item.username || item.uname || '?');
    const stats = dim(`❤️${item.likenum||0} 💬${item.replynum||0}`);
    const id = dim(`id=${item.id||item.uid}`);
    const time = dim(timeAgo(item.dateline || item.lastupdate));
    console.log(`${dim(`${i+1}.`)} [${author}] ${msg}`);
    console.log(`   ${stats} ${time} ${id}`);
  });
}

async function cmdFeed() {
  const id = getPositional()[0];
  if (!id) { console.log('用法: coolapk feed <id>'); return; }

  const d = await api.feedDetail(id);
  if (JSON_MODE) { console.log(JSON.stringify(d, null, 2)); return; }

  console.log(bold(`[${d.username}] ${d.message_title || ''}`));
  console.log('');
  console.log(stripHtml(d.message));
  // 图片
  if (d.picArr && d.picArr.length) {
    console.log('');
    console.log(dim(`📷 ${d.picArr.length} 张图片:`));
    d.picArr.forEach((pic, i) => console.log(dim(`   ${i+1}. ${pic.url || pic}`)));
  }
  console.log('');
  console.log(`${dim('❤️')} ${d.likenum}  ${dim('💬')} ${d.replynum}  ${dim('🔗')} ${d.sharenum}  ${dim(timeAgo(d.dateline))}`);
}

async function cmdReplies() {
  const id = getPositional()[0];
  if (!id) { console.log('用法: coolapk replies <id> [--pages N] [--sort hot|new] [--sentiment]'); return; }

  const pages = parseInt(getOpt('pages', '1'));
  const sort = getOpt('sort', 'hot');
  const startPage = parseInt(getOpt('page', '1'));

  let allData = [];
  for (let p = startPage; p < startPage + Math.min(pages, 10); p++) {
    const data = await api.feedReplies(id, p, sort);
    if (!data.length) break;
    allData.push(...data);
  }

  // 情感分析
  let sentiments = null;
  if (SENTIMENT && allData.length) {
    await loadSentiment();
    if (sentimentReady) {
      const texts = allData.map(item => stripHtml(item.message));
      sentiments = await analyzeBatch(texts);
    }
  }

  if (JSON_MODE) {
    if (sentiments) allData.forEach((item, i) => { item._sentiment = sentiments[i]; });
    console.log(JSON.stringify(allData, null, 2));
    return;
  }

  console.log(`${bold(`帖子 ${id} 的评论`)} · ${allData.length} 条${pages > 1 ? ` (${pages}页)` : ''} · 排序: ${sort === 'hot' ? '热门' : '最新'}\n`);

  allData.forEach((item, i) => {
    const msg = stripHtml(item.message);
    const author = cyan(item.username);
    const likes = item.likenum > 0 ? yellow(`❤️${item.likenum}`) : dim(`❤️0`);
    const replies = item.replynum > 0 ? `💬${item.replynum}` : '';
    const time = dim(timeAgo(item.dateline));
    const sLabel = sentiments ? ` ${sentimentLabel(sentiments[i].score)}` : '';
    console.log(`[${author}] ${msg}`);
    console.log(`  ${likes} ${replies} ${time}${sLabel}\n`);
  });

  // 情感统计摘要
  if (sentiments) {
    const pos = sentiments.filter(s => s.score > 0.6).length;
    const neg = sentiments.filter(s => s.score < 0.4).length;
    const neu = sentiments.length - pos - neg;
    console.log(dim(`── 情感统计 ──`));
    console.log(`${green(`👍正面 ${pos}`)}  ${red(`👎负面 ${neg}`)}  ${dim(`😐中性 ${neu}`)}  (共${sentiments.length}条)`);
  }
}

async function cmdUser() {
  const uid = getPositional()[0];
  if (!uid) { console.log('用法: coolapk user <uid> [--feeds] [--pages N]'); return; }

  const showFeeds = rawArgs.includes('--feeds');
  const d = await api.userProfile(uid);

  if (!showFeeds) {
    if (JSON_MODE) { console.log(JSON.stringify(d, null, 2)); return; }
    console.log(bold(`${d.username}`) + dim(` (uid: ${d.uid})`));
    console.log(`粉丝 ${yellow(String(d.fans))} | 关注 ${d.follow} | 动态 ${d.feed}`);
    if (d.bio) console.log(dim(`简介: ${d.bio}`));
    return;
  }

  // --feeds 模式：显示用户发帖列表
  const pages = parseInt(getOpt('pages', '1'));
  let allFeeds = [];
  for (let p = 1; p <= Math.min(pages, 5); p++) {
    const data = await api.userFeed(uid, p);
    if (!data || !data.length) break;
    allFeeds.push(...data);
  }

  if (JSON_MODE) { console.log(JSON.stringify(allFeeds, null, 2)); return; }

  console.log(bold(`${d.username} 的动态`) + dim(` · ${allFeeds.length} 条${pages > 1 ? ` (${pages}页)` : ''}`));
  console.log('');
  allFeeds.forEach((item, i) => {
    const msg = truncate(stripHtml(item.message_title || item.message || ''), 80);
    console.log(`${dim(`${i+1}.`)} ${msg}`);
    console.log(`   ${dim(`❤️${item.likenum||0} 💬${item.replynum||0}`)} ${dim(timeAgo(item.dateline))} ${dim(`id=${item.id}`)}`);
  });
}

async function cmdIndex() {
  const page = parseInt(getOpt('page', '1'));
  const data = await api.indexV8(page);
  const feeds = data.filter(item => item.entityType === 'feed');

  if (JSON_MODE) { console.log(JSON.stringify(feeds, null, 2)); return; }

  console.log(`${bold('首页 Feed')} · ${feeds.length} 条\n`);
  feeds.forEach(item => {
    const msg = truncate(stripHtml(item.message || ''), 80);
    console.log(`[${cyan(item.username)}] ${msg}`);
    console.log(`  ${dim(`❤️${item.likenum||0} 💬${item.replynum||0}`)} ${dim(timeAgo(item.dateline))} ${dim(`id=${item.id}`)}`);
  });
}

async function cmdTopic() {
  const tag = getPositional()[0];
  if (!tag) { console.log('用法: coolapk topic <标签名> [--feeds] [--pages N] [--sort hot|new]'); return; }

  const showFeeds = rawArgs.includes('--feeds');
  const d = await api.topicDetail(tag);

  if (JSON_MODE && !showFeeds) { console.log(JSON.stringify(d, null, 2)); return; }

  console.log(bold(`#${d.title}#`));
  console.log(`关注 ${yellow(String(d.follownum))} | 帖子 ${d.commentnum}`);
  if (d.description) console.log(dim(d.description.substring(0, 200)));

  if (!showFeeds) return;

  // --feeds 模式：话题下帖子
  const pages = parseInt(getOpt('pages', '1'));
  const sort = getOpt('sort', 'hot');
  let allFeeds = [];
  for (let p = 1; p <= Math.min(pages, 5); p++) {
    try {
      const data = await api.topicFeeds(tag, p, sort);
      if (!data || !data.length) break;
      allFeeds.push(...data.filter(item => item.entityType === 'feed' || item.id));
    } catch { break; }
  }

  if (JSON_MODE) { console.log(JSON.stringify(allFeeds, null, 2)); return; }

  console.log(`\n${bold('帖子列表')} · ${allFeeds.length} 条 · 排序: ${sort === 'hot' ? '热门' : '最新'}\n`);
  allFeeds.forEach((item, i) => {
    const msg = truncate(stripHtml(item.message_title || item.message || ''), 80);
    console.log(`${dim(`${i+1}.`)} [${cyan(item.username || '?')}] ${msg}`);
    console.log(`   ${dim(`❤️${item.likenum||0} 💬${item.replynum||0}`)} ${dim(timeAgo(item.dateline))} ${dim(`id=${item.id}`)}`);
  });
}

async function cmdHot() {
  const data = await api.hotList(3);

  if (JSON_MODE) { console.log(JSON.stringify(data, null, 2)); return; }

  console.log(`${bold('🔥 酷安热榜')} · ${data.length} 条（按点赞排序）\n`);
  data.slice(0, 30).forEach((item, i) => {
    const msg = truncate(stripHtml(item.message_title || item.message || ''), 60);
    console.log(`${dim(`${i+1}.`.padStart(4))} [${cyan(item.username || '?')}] ${msg}`);
    console.log(`      ${yellow(`❤️${item.likenum||0}`)} 💬${item.replynum||0} ${dim(timeAgo(item.dateline))} ${dim(`id=${item.id}`)}`);
  });
}

async function cmdBatch() {
  const keywords = getPositional();
  if (!keywords.length) { console.log('用法: coolapk batch <词1> <词2> ... [--pages N] [--since 7d]'); return; }

  const pages = parseInt(getOpt('pages', '2'));
  const since = parseSince(getOpt('since', null));
  const seen = new Set();
  let all = [];

  for (const q of keywords) {
    process.stderr.write(dim(`搜索 "${q}"...\n`));
    const data = await api.searchAll(q, { type: 'feed', maxPages: Math.min(pages, 5) });
    for (const item of data) {
      const id = String(item.id);
      if (!seen.has(id)) { seen.add(id); all.push(item); }
    }
  }
  all = filterBySince(all, since);
  // 按点赞排序
  all.sort((a, b) => (b.likenum || 0) - (a.likenum || 0));

  if (JSON_MODE) { console.log(JSON.stringify(all, null, 2)); return; }

  console.log(`${bold(`批量搜索`)} [${keywords.join(', ')}] · ${all.length} 条（已去重，按热度排序）\n`);
  all.forEach((item, i) => {
    const msg = truncate(stripHtml(item.message_title || item.message || ''), 100);
    console.log(`${dim(`${i+1}.`)} [${cyan(item.username || '?')}] ${msg}`);
    console.log(`   ${dim(`❤️${item.likenum||0} 💬${item.replynum||0}`)} ${dim(timeAgo(item.dateline))} ${dim(`id=${item.id}`)}`);
  });
}

async function cmdReport() {
  const q = getPositional()[0];
  if (!q) { console.log('用法: coolapk report <关键词> [--pages N]'); return; }

  const pages = parseInt(getOpt('pages', '3'));

  // 1. 搜索
  process.stderr.write(dim(`[1/4] 搜索 "${q}"...\n`));
  const posts = await api.searchAll(q, { type: 'feed', maxPages: Math.min(pages, 5) });
  posts.sort((a, b) => (b.likenum || 0) - (a.likenum || 0));

  // 2. 拉取 top 5 帖子的评论
  const topPosts = posts.slice(0, 5);
  let allComments = [];
  process.stderr.write(dim(`[2/4] 获取 Top ${topPosts.length} 帖评论...\n`));
  for (const post of topPosts) {
    try {
      const comments = await api.feedReplies(String(post.id), 1, 'hot');
      allComments.push(...comments);
    } catch (e) { /* 跳过风控帖 */ }
  }

  // 3. 情感分析
  process.stderr.write(dim(`[3/4] 情感分析 ${allComments.length} 条评论...\n`));
  await loadSentiment();
  let sentiments = null;
  if (sentimentReady && allComments.length) {
    const texts = allComments.map(item => stripHtml(item.message));
    sentiments = await analyzeBatch(texts);
  }

  // 4. 词频
  process.stderr.write(dim(`[4/4] 词频统计...\n`));
  const allTexts = [
    ...posts.map(p => stripHtml(p.message || '')),
    ...allComments.map(c => stripHtml(c.message || '')),
  ];
  const freq = wordFreq(allTexts, 25);

  // --- 输出 ---
  if (JSON_MODE) {
    const report = { query: q, posts: posts.length, topPosts: topPosts.map(p => ({ id: p.id, title: p.message_title, likes: p.likenum, replies: p.replynum })),
      comments: allComments.length, sentiment: sentiments ? { positive: sentiments.filter(s=>s.score>0.6).length, negative: sentiments.filter(s=>s.score<0.4).length, neutral: sentiments.filter(s=>s.score>=0.4&&s.score<=0.6).length } : null,
      wordFreq: freq.map(([w, c]) => ({ word: w, count: c })) };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\n${bold(`═══ 酷安舆论报告: "${q}" ═══`)}\n`);

  // 帖子概览
  console.log(bold(`📋 帖子 (${posts.length} 条，按热度)`));
  posts.slice(0, 10).forEach((item, i) => {
    const msg = truncate(stripHtml(item.message_title || item.message || ''), 60);
    console.log(`  ${dim(`${i+1}.`)} [${cyan(item.username)}] ${msg} ${dim(`❤️${item.likenum} 💬${item.replynum}`)}`);
  });
  if (posts.length > 10) console.log(dim(`  ... 还有 ${posts.length - 10} 条`));

  // 情感分析
  if (sentiments) {
    const pos = sentiments.filter(s => s.score > 0.6).length;
    const neg = sentiments.filter(s => s.score < 0.4).length;
    const neu = sentiments.length - pos - neg;
    const total = sentiments.length;
    console.log('');
    console.log(bold(`💭 情感分析 (${total} 条评论)`));
    const barLen = 30;
    const posBar = '█'.repeat(Math.round(pos/total*barLen));
    const neuBar = '░'.repeat(Math.round(neu/total*barLen));
    const negBar = '▓'.repeat(Math.round(neg/total*barLen));
    console.log(`  ${green(posBar)}${dim(neuBar)}${red(negBar)}`);
    console.log(`  ${green(`正面 ${pos} (${Math.round(pos/total*100)}%)`)}  ${dim(`中性 ${neu} (${Math.round(neu/total*100)}%)`)}  ${red(`负面 ${neg} (${Math.round(neg/total*100)}%)`)}`);

    // Top 正面/负面评论
    const sorted = allComments.map((c, i) => ({ ...c, score: sentiments[i].score }));
    const topPos = sorted.filter(c => c.score > 0.6).sort((a,b) => (b.likenum||0) - (a.likenum||0)).slice(0, 3);
    const topNeg = sorted.filter(c => c.score < 0.4).sort((a,b) => (b.likenum||0) - (a.likenum||0)).slice(0, 3);
    if (topPos.length) {
      console.log(`\n  ${green('▲ 高赞正面:')}`);
      topPos.forEach(c => console.log(`    "${truncate(stripHtml(c.message), 60)}" ${dim(`❤️${c.likenum}`)}`));
    }
    if (topNeg.length) {
      console.log(`\n  ${red('▼ 高赞负面:')}`);
      topNeg.forEach(c => console.log(`    "${truncate(stripHtml(c.message), 60)}" ${dim(`❤️${c.likenum}`)}`));
    }
  }

  // 词频
  console.log('');
  console.log(bold(`📊 高频词 (Top 20)`));
  const maxCount = freq[0] ? freq[0][1] : 1;
  freq.slice(0, 20).forEach(([word, count]) => {
    const bar = '▇'.repeat(Math.round(count / maxCount * 15));
    console.log(`  ${yellow(word.padEnd(8))} ${dim(bar)} ${count}`);
  });

  console.log(`\n${dim(`── 数据：${posts.length} 帖 / ${allComments.length} 评论 / ${new Date().toLocaleString()} ──`)}`);
}

function showHelp() {
  console.log(`${bold('酷安 API CLI')} v1.1.0\n`);
  console.log('命令:');
  console.log(`  ${green('search')} <关键词>       搜索帖子/用户/应用`);
  console.log(`  ${green('feed')} <id>             帖子详情（完整正文+图片）`);
  console.log(`  ${green('replies')} <id>          帖子评论（默认热门排序）`);
  console.log(`  ${green('user')} <uid>            用户主页 [--feeds 发帖列表]`);
  console.log(`  ${green('index')}                 首页 feed`);
  console.log(`  ${green('topic')} <tag>           话题详情 [--feeds 话题帖子]`);
  console.log(`  ${green('hot')}                   🔥 热榜`);
  console.log(`  ${green('batch')} <词1> <词2> ... 多关键词批量搜索（去重+按热度）`);
  console.log(`  ${green('report')} <关键词>       一键舆论报告（搜索+评论+情感+词频）`);
  console.log('');
  console.log('选项:');
  console.log(`  --pages N            批量获取多页`);
  console.log(`  --sort hot|new       排序方式（评论默认 hot）`);
  console.log(`  --since Nd           只看 N 天内（如 --since 7d）`);
  console.log(`  --sentiment          对评论做情感分析标注`);
  console.log(`  --type feed|user     搜索类型`);
  console.log(`  --json               输出 JSON`);
  console.log(`  --no-color           禁用颜色`);
  console.log('');
  console.log('示例:');
  console.log(dim(`  coolapk search "HyperOS" --pages 3 --since 7d`));
  console.log(dim(`  coolapk replies 71992686 --pages 5 --sentiment`));
  console.log(dim(`  coolapk batch "rust桌面" "HyperOS" "澎湃OS" --since 3d`));
  console.log(dim(`  coolapk report "rust桌面"`));
  console.log(dim(`  coolapk hot`));
}

// --- 主入口 ---

async function main() {
  try {
    switch (cmd) {
      case 'search': await cmdSearch(); break;
      case 'feed': await cmdFeed(); break;
      case 'replies': await cmdReplies(); break;
      case 'user': await cmdUser(); break;
      case 'index': await cmdIndex(); break;
      case 'topic': await cmdTopic(); break;
      case 'hot': await cmdHot(); break;
      case 'batch': await cmdBatch(); break;
      case 'report': await cmdReport(); break;
      case '--help': case '-h': case 'help': showHelp(); break;
      default: showHelp();
    }
  } catch (e) {
    if (e.message.includes('风控')) {
      console.error(red('⚠️  触发风控，请稍后重试（30秒内避免重复请求）'));
    } else if (e.message.includes('ENOTFOUND') || e.message.includes('ETIMEDOUT')) {
      console.error(red('❌ 网络连接失败，检查网络'));
    } else if (e.message.includes('ECONNRESET')) {
      console.error(red('❌ 连接被重置，可能被代理拦截（避免使用香港 IP）'));
    } else {
      console.error(red(`❌ ${e.message}`));
    }
    process.exit(1);
  }
}

main();
