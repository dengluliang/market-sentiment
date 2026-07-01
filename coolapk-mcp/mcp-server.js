#!/usr/bin/env node
/**
 * 酷安 API MCP Server
 *
 * 通过 stdio JSON-RPC 提供酷安数据查询能力。
 * 精简输出：去除空值字段，节省 AI 上下文 token。
 *
 * 启动：node mcp-server.js
 */

const CoolapkAPI = require('./src/index');
const api = new CoolapkAPI({ rateLimit: true });

// --- 精简序列化：去除空值/零值/空字符串字段 ---

function compact(obj) {
  if (Array.isArray(obj)) return obj.map(compact);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === '' || v === 0 || (Array.isArray(v) && !v.length)) continue;
      out[k] = compact(v);
    }
    return out;
  }
  return obj;
}

function stripHtml(s) {
  return (s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .trim();
}

function formatFeed(item) {
  return compact({
    id: String(item.id || item.uid),
    author: item.username || item.uname,
    title: stripHtml(item.message_title || item.title || ''),
    content: stripHtml(item.message || '').substring(0, 200),
    likes: item.likenum,
    replies: item.replynum,
    shares: item.sharenum,
    pics: item.picArr && item.picArr.length ? item.picArr.length : undefined,
  });
}

function formatReply(item) {
  return compact({
    author: item.username,
    content: stripHtml(item.message).substring(0, 200),
    likes: item.likenum,
    replies: item.replynum,
  });
}

// --- Tool 定义 ---

const TOOLS = [
  {
    name: 'coolapk_search',
    description: '搜索酷安帖子/用户/应用。返回标题、作者、点赞数、评论数等（精简格式，空值已省略）。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        type: { type: 'string', enum: ['feed', 'user', 'app'], default: 'feed', description: '搜索类型' },
        page: { type: 'number', default: 1, description: '页码' },
        max_pages: { type: 'number', default: 1, description: '批量搜索最大页数（1-5）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'coolapk_feed',
    description: '获取帖子详情 + 热门评论（合并返回，一次拿到正文和评论区）。默认附带前 20 条热门评论。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '帖子 ID' },
        include_replies: { type: 'boolean', default: true, description: '是否附带评论（默认 true）' },
        reply_pages: { type: 'number', default: 1, description: '评论页数（1-3）' },
      },
      required: ['id'],
    },
  },
  {
    name: 'coolapk_replies',
    description: '单独获取帖子评论（当需要更多页评论时使用）。默认热门排序。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '帖子 ID' },
        page: { type: 'number', default: 1, description: '页码' },
        pages: { type: 'number', default: 1, description: '获取多少页（1-5）' },
        sort: { type: 'string', enum: ['hot', 'new'], default: 'hot', description: '排序：hot=热门 new=最新' },
      },
      required: ['id'],
    },
  },
  {
    name: 'coolapk_user',
    description: '获取酷安用户信息。可附带用户发帖列表。',
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: '用户 UID' },
        include_feeds: { type: 'boolean', default: false, description: '附带用户发帖列表' },
        feed_pages: { type: 'number', default: 1, description: '发帖列表页数（1-3）' },
      },
      required: ['uid'],
    },
  },
  {
    name: 'coolapk_topic',
    description: '获取酷安话题详情。可附带话题下帖子列表。',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: '话题标签名' },
        include_feeds: { type: 'boolean', default: false, description: '附带话题下帖子' },
        feed_pages: { type: 'number', default: 1, description: '帖子列表页数（1-3）' },
        sort: { type: 'string', enum: ['hot', 'new'], default: 'hot', description: '帖子排序' },
      },
      required: ['tag'],
    },
  },
  {
    name: 'coolapk_hot',
    description: '获取酷安当前热榜（按点赞排序 Top 20）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'coolapk_batch_search',
    description: '多关键词批量搜索，自动去重并按热度排序。适合同时监测多个相关话题。',
    inputSchema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' }, description: '关键词列表' },
        pages_per_keyword: { type: 'number', default: 2, description: '每个词搜多少页（1-5）' },
      },
      required: ['keywords'],
    },
  },
];

// --- Tool 执行 ---

async function handleTool(name, args) {
  switch (name) {
    case 'coolapk_search': {
      const maxPages = Math.min(args.max_pages || 1, 5);
      let data;
      if (maxPages > 1) {
        data = await api.searchAll(args.query, { type: args.type || 'feed', maxPages });
      } else {
        data = await api.search(args.query, args.type || 'feed', args.page || 1);
      }
      const results = data.map(formatFeed);
      return JSON.stringify(compact({ query: args.query, count: results.length, results }));
    }

    case 'coolapk_feed': {
      const d = await api.feedDetail(args.id);
      const feed = compact({
        id: String(d.id),
        author: d.username,
        title: stripHtml(d.message_title || ''),
        content: stripHtml(d.message),
        likes: d.likenum,
        replies_count: d.replynum,
        shares: d.sharenum,
        pics: d.picArr && d.picArr.length ? d.picArr.map(p => p.url || p) : undefined,
      });

      // 附带评论
      if (args.include_replies !== false) {
        const replyPages = Math.min(args.reply_pages || 1, 3);
        let replies = [];
        for (let p = 1; p <= replyPages; p++) {
          try {
            const page = await api.feedReplies(String(d.id), p, 'hot');
            if (!page.length) break;
            replies.push(...page);
          } catch { break; }
        }
        feed.hot_replies = replies.map(formatReply);
      }

      return JSON.stringify(feed);
    }

    case 'coolapk_replies': {
      const pages = Math.min(args.pages || 1, 5);
      const sort = args.sort || 'hot';
      let all = [];
      for (let p = args.page || 1; p < (args.page || 1) + pages; p++) {
        const data = await api.feedReplies(args.id, p, sort);
        if (!data.length) break;
        all.push(...data);
      }
      const replies = all.map(formatReply);
      return JSON.stringify(compact({ post_id: args.id, sort, count: replies.length, replies }));
    }

    case 'coolapk_user': {
      const d = await api.userProfile(args.uid);
      const result = compact({
        username: d.username, uid: d.uid,
        fans: d.fans, follow: d.follow, feed: d.feed,
        bio: d.bio,
      });

      if (args.include_feeds) {
        const feedPages = Math.min(args.feed_pages || 1, 3);
        let feeds = [];
        for (let p = 1; p <= feedPages; p++) {
          try {
            const data = await api.userFeed(args.uid, p);
            if (!data || !data.length) break;
            feeds.push(...data);
          } catch { break; }
        }
        result.feeds = feeds.map(formatFeed);
      }

      return JSON.stringify(result);
    }

    case 'coolapk_topic': {
      const d = await api.topicDetail(args.tag);
      const result = compact({
        title: d.title, followers: d.follownum, posts: d.commentnum,
        description: (d.description || '').substring(0, 200),
      });

      if (args.include_feeds) {
        const feedPages = Math.min(args.feed_pages || 1, 3);
        const sort = args.sort || 'hot';
        let feeds = [];
        for (let p = 1; p <= feedPages; p++) {
          try {
            const data = await api.topicFeeds(args.tag, p, sort);
            if (!data || !data.length) break;
            feeds.push(...data.filter(item => item.entityType === 'feed' || item.id).map(formatFeed));
          } catch { break; }
        }
        result.feeds = feeds;
      }

      return JSON.stringify(result);
    }

    case 'coolapk_hot': {
      const data = await api.hotList(3);
      const results = data.slice(0, 20).map(formatFeed);
      return JSON.stringify(compact({ count: results.length, results }));
    }

    case 'coolapk_batch_search': {
      const keywords = args.keywords || [];
      const pagesEach = Math.min(args.pages_per_keyword || 2, 5);
      const seen = new Set();
      let all = [];
      for (const q of keywords) {
        const data = await api.searchAll(q, { type: 'feed', maxPages: pagesEach });
        for (const item of data) {
          const id = String(item.id);
          if (!seen.has(id)) { seen.add(id); all.push(item); }
        }
      }
      all.sort((a, b) => (b.likenum || 0) - (a.likenum || 0));
      const results = all.map(formatFeed);
      return JSON.stringify(compact({ keywords, count: results.length, results }));
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- MCP JSON-RPC 传输（stdio） ---

let buffer = '';

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function handleMessage(msg) {
  const { id, method, params } = msg;

  // JSON-RPC notification：没有 id 的消息绝不能回复。
  // 某些 MCP 客户端会发送 notifications/initialized；若 server 回复，会导致客户端误判/循环。
  if (id === undefined || id === null) {
    return;
  }

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'coolapk-mcp', version: '1.1.1' },
        },
      });
      break;

    case 'notifications/initialized':
      break;

    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      break;

    case 'tools/call':
      handleTool(params.name, params.arguments || {})
        .then(text => {
          send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
        })
        .catch(err => {
          send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `❌ ${err.message}` }], isError: true } });
        });
      break;

    default:
      if (id) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
  }
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = buffer.substring(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.substring(headerEnd + 4); continue; }
    const len = parseInt(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) break;
    const body = buffer.substring(bodyStart, bodyStart + len);
    buffer = buffer.substring(bodyStart + len);
    try {
      handleMessage(JSON.parse(body));
    } catch (e) {
      process.stderr.write(`Parse error: ${e.message}\n`);
    }
  }
});

process.stderr.write('🔍 酷安 MCP Server v1.1.1 已启动 (stdio)\n');
