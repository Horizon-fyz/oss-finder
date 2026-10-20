/**
 * 全局配置：想调口味、改频次、加方向，只改这个文件。
 */

export const CONFIG = {
  // ---- 输出 ----
  dailyTop: 10,              // 每日精选条数
  maxCandidates: 400,        // 单日候选池上限（防止异常数据）
  dedupeDays: 120,           // 已推荐过的项目，多少天内不再重复推
  resurfaceDelta: 400,       // 但 24h 涨星超过这个数可以破例复推

  // ---- 过滤 ----
  minStars: 40,              // 低于此星数不进候选
  maxAgeDaysHard: 3650,      // 超过 10 年的老项目基本不看了
  minStarsPerDay: 0.8,       // 老项目日均涨星低于此值直接丢

  // ---- 网络 ----
  searchPaceMs: 6500,        // GitHub 匿名搜索限流 10 次/分钟
  hnLookbackHours: 48,       // HN 只看最近 48 小时
  hnMinPoints: 20,
  hnEnrichLimit: 8,          // HN 独家发现，最多额外查 8 个仓库元数据

  // ---- 兴趣权重（用户选择：全面铺开，但三个方向加权）----
  interest: {
    ai:       { weight: 1.00, label: 'AI / LLM / Agent' },
    devtools: { weight: 0.90, label: '开发者工具 / 基础设施' },
    systems:  { weight: 0.90, label: '系统 / 底层 / 性能' },
    general:  { weight: 0.45, label: '综合' },
  },

  keywords: {
    ai: [
      'llm', 'llms', 'gpt', 'ai', 'agent', 'agents', 'rag', 'mcp', 'llmops',
      'diffusion', 'transformer', 'inference', 'embedding', 'embeddings', 'vlm',
      'multimodal', 'fine-tun', 'finetun', 'ollama', 'vllm', 'prompt', 'chatbot',
      'neural', 'model serving', 'quantization', 'lora', 'copilot', 'semantic search',
      'vector database', 'speech', 'tts', 'asr', 'ocr',
    ],
    devtools: [
      'cli', 'terminal', 'code editor', 'text editor', 'debugger', 'devtool', 'linter',
      'formatter', 'package manager', 'vscode', 'language server', 'lsp', 'build system',
      'bundler', 'test runner', 'git', 'monorepo', 'code review', 'static analysis',
      'observability', 'tracing', 'logging', 'metrics', 'devops', 'kubernetes',
      'docker', 'ci/cd', 'infrastructure', 'self-hosted', 'homebrew', 'shell',
    ],
    systems: [
      'kernel', 'runtime', 'allocator', 'filesystem', 'file system', 'storage engine',
      'database', 'distributed', 'consensus', 'vm', 'virtual machine', 'hypervisor',
      'wasm', 'webassembly', 'ebpf', 'scheduler', 'compiler', 'interpreter', 'jit',
      'proxy', 'networking', 'tcp', 'http/3', 'quic', 'cache', 'memory safety',
      'concurrency', 'actor', 'actor model', 'container', 'sandbox', 'emulator',
      'reverse engineering', 'binary', 'fuzzing', 'zero-copy', 'low-latency',
    ],
  },

  // 命中这些词的多半是清单/教程，不是项目
  blockPatterns: [
    'awesome', 'curated list', 'a list of', 'list of ', 'cheat sheet', 'cheatsheet',
    'roadmap', 'tutorial', 'tutorials', 'course', 'courses', 'interview',
    'programming books', 'free books', 'handbook', 'questions and answers',
    'study guide', 'learning path', 'resources for', 'collection of resources',
    'curriculum', 'notes for professionals', 'design patterns', '从入门到',
    '教程', '面试', '学习路线', '资源集合',
  ],

  /**
   * 查询池。
   * core：每天必跑，负责「新项目爆发」这条主线。
   * byWeekday：按星期轮换，一周覆盖全部方向，兼顾广度与 API 配额。
   * {t} 会被替换成相对日期。
   */
  queries: {
    core: [
      {
        id: 'new-week',
        label: '一周内新项目',
        q: 'created:>{7d} stars:>40',
        sort: 'stars',
      },
      {
        id: 'rising-month',
        label: '近一月上升最快',
        q: 'created:>{30d} stars:>150',
        sort: 'stars',
      },
    ],
    byWeekday: {
      1: [ // 周一 AI
        { id: 'ai-agent', label: 'AI Agent', q: 'topic:ai-agent stars:>80 created:>{90d}', sort: 'stars' },
        { id: 'llm', label: 'LLM 工具', q: 'topic:llm stars:>150 created:>{120d}', sort: 'stars' },
      ],
      2: [ // 周二 开发者工具
        { id: 'devtools', label: '开发者工具', q: 'topic:developer-tools stars:>100 created:>{120d}', sort: 'stars' },
        { id: 'cli', label: '命令行工具', q: 'topic:cli stars:>100 created:>{120d}', sort: 'stars' },
      ],
      3: [ // 周三 系统底层
        { id: 'systems', label: '系统编程', q: 'topic:systems-programming stars:>80 created:>{120d}', sort: 'stars' },
        { id: 'compiler', label: '编译器/语言', q: 'topic:compiler stars:>80 created:>{150d}', sort: 'stars' },
      ],
      4: [ // 周四 数据与分布式
        { id: 'database', label: '数据库', q: 'topic:database stars:>150 created:>{150d}', sort: 'stars' },
        { id: 'distributed', label: '分布式系统', q: 'topic:distributed-systems stars:>80 created:>{150d}', sort: 'stars' },
      ],
      5: [ // 周五 语言生态
        { id: 'rust', label: 'Rust 生态', q: 'language:rust stars:>200 created:>{60d}', sort: 'stars' },
        { id: 'zig', label: 'Zig / 新语言', q: 'language:zig stars:>100 created:>{180d}', sort: 'stars' },
      ],
      6: [ // 周六 可观测 / 自托管
        { id: 'observability', label: '可观测性', q: 'topic:observability stars:>80 created:>{180d}', sort: 'stars' },
        { id: 'selfhosted', label: '自托管', q: 'topic:self-hosted stars:>200 created:>{120d}', sort: 'stars' },
      ],
      0: [ // 周日 安全 / 逆向
        { id: 'security', label: '安全工具', q: 'topic:security stars:>150 created:>{120d}', sort: 'stars' },
        { id: 'reversing', label: '逆向工程', q: 'topic:reverse-engineering stars:>80 created:>{180d}', sort: 'stars' },
      ],
    },
  },
};
