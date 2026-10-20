/**
 * 能力分类体系。
 *
 * 这套表是「需求 → 项目」的翻译层：用户说中文需求，库里存的是英文描述，
 * 中间靠 capabilities 的 zhAliases / aliases / topics 做映射。
 *
 * 字段：
 *   id        能力标识
 *   zh/en     展示名
 *   topics    GitHub topic（采集用，也是最强的分类信号）
 *   aliases   英文关键词（描述里出现即命中；也是英文查询的扩展词）
 *   zhAliases 中文说法（用户可能怎么描述这个能力）
 *   composes  拆解关系：做这件事通常还需要哪些子能力
 */

const cap = (id, zh, en, topics, aliases, zhAliases, composes = []) => ({
  id, zh, en, topics, aliases, zhAliases, composes,
});

export const CAPABILITIES = [
  // ---------- 文档 / 内容 ----------
  cap('pdf', 'PDF 处理', 'PDF processing',
    ['pdf', 'pdf-generation', 'pdf-parser'],
    ['pdf', 'pdf.js', 'pdf-lib', 'pdf parser', 'pdf generation', 'pdf rendering', 'pdf reader', 'pdf writer', 'pdf manipulation', 'pdfium'],
    ['PDF', 'PDF 生成', 'PDF 编辑', 'PDF 转换', '发票解析'],
    ['ocr', 'doc-parsing']),

  cap('doc-parsing', '文档解析 / 表格提取', 'Document parsing',
    ['document-parser', 'pdf-parsing', 'document-ai', 'layout-analysis'],
    ['document parsing', 'document parser', 'pdf parsing', 'table extraction', 'table recognition', 'layout analysis', 'information extraction', 'document ai', 'document understanding', 'structured extraction', 'text extraction'],
    ['文档解析', '表格提取', 'PDF 解析', '文档结构化', '信息抽取', '版面分析', '文档识别'],
    ['pdf', 'ocr', 'cv']),

  cap('ocr', '文字识别', 'OCR',
    ['ocr', 'text-recognition', 'tesseract'],
    ['ocr', 'optical character recognition', 'text recognition', 'handwriting recognition', 'document recognition'],
    ['OCR', '文字识别', '图片转文字', '票据识别'],
    ['image-processing', 'cv']),

  cap('office', 'Office 文档处理', 'Office documents',
    ['docx', 'xlsx', 'pptx', 'office'],
    ['docx', 'xlsx', 'pptx', 'word document', 'excel file', 'powerpoint', 'spreadsheet manipulation', 'ooxml'],
    ['Word', 'Excel', 'PPT', 'Office 文档', '文档生成'],
    []),

  cap('doc-convert', '文档格式转换', 'Document conversion',
    ['document-conversion', 'pandoc', 'file-conversion'],
    ['document conversion', 'convert document', 'pandoc', 'docx to pdf', 'markdown to pdf', 'html to pdf', 'file converter'],
    ['文档转换', '格式转换', '转 PDF', '转 Word', '文件格式互转'],
    ['pdf', 'office']),

  cap('markdown', 'Markdown 处理', 'Markdown',
    ['markdown', 'markdown-parser', 'markdown-editor'],
    ['markdown', 'md parser', 'markdown editor', 'gfm', 'commonmark'],
    ['Markdown', '富文本', 'Markdown 编辑器'],
    []),

  cap('spreadsheet', '表格处理', 'Spreadsheet',
    ['spreadsheet', 'csv', 'excel'],
    ['spreadsheet', 'csv parser', 'csv', 'formula engine', 'excel formula', 'tabular data'],
    ['表格', 'Excel 表格', 'CSV', '电子表格'],
    []),

  // ---------- AI ----------
  cap('llm-serving', '模型推理部署', 'LLM serving',
    ['llm-inference', 'llama', 'vllm', 'ollama'],
    ['llm inference', 'local llm', 'model serving', 'inference engine', 'quantization', 'gguf', 'llama.cpp', 'run llm locally'],
    ['本地大模型', '推理引擎', '模型部署', '跑模型'],
    ['gpu-compute']),

  cap('llm-app', 'LLM 应用 / Agent', 'LLM app & agents',
    ['llm', 'ai-agent', 'ai-agents', 'agent-framework'],
    ['agent framework', 'llm app', 'prompt', 'tool calling', 'function calling', 'chatbot', 'copilot', 'mcp server', 'llm orchestration'],
    ['智能体', 'Agent 框架', '大模型应用', '对话机器人', 'MCP'],
    ['llm-serving', 'rag', 'vector-db']),

  cap('rag', '检索增强生成', 'RAG',
    ['rag', 'retrieval-augmented-generation', 'knowledge-base'],
    ['rag', 'retrieval augmented', 'rag engine', 'retrieval', 'chunking', 'rerank', 'document qa', 'chat with your documents', 'grounding', 'llm memory'],
    ['知识库', '检索增强', 'RAG', '文档问答', '企业知识库', '问答机器人'],
    ['doc-parsing', 'pdf', 'embedding', 'vector-db', 'search-engine']),

  cap('embedding', '向量化 / 语义相似', 'Embeddings',
    ['embeddings', 'embedding', 'sentence-transformers'],
    ['embedding', 'embeddings', 'vectorize', 'sentence transformer', 'semantic similarity', 'text embedding'],
    ['向量化', '语义相似度', '文本向量'],
    []),

  cap('vector-db', '向量数据库', 'Vector database',
    ['vector-database', 'vector-search', 'similarity-search'],
    ['vector database', 'vector search', 'similarity search', 'faiss', 'hnsw', 'ann index', 'nearest neighbor'],
    ['向量数据库', '相似度检索', '向量检索'],
    []),

  cap('fine-tuning', '模型微调训练', 'Fine-tuning',
    ['fine-tuning', 'lora', 'training-framework'],
    ['fine-tune', 'finetuning', 'lora', 'training framework', 'distributed training', 'rlhf', 'pretraining'],
    ['微调', '训练框架', 'LoRA', '模型训练'],
    ['gpu-compute']),

  cap('speech', '语音识别 / 合成', 'Speech',
    ['speech-recognition', 'text-to-speech', 'asr'],
    ['speech recognition', 'asr', 'tts', 'text to speech', 'whisper', 'voice cloning', 'speech to text'],
    ['语音识别', '语音合成', '转写', '变声'],
    ['audio', 'llm-serving']),

  cap('cv', '计算机视觉', 'Computer vision',
    ['computer-vision', 'object-detection', 'image-segmentation'],
    ['computer vision', 'object detection', 'segmentation', 'face detection', 'pose estimation', 'yolo', 'image classification', 'face recognition'],
    ['目标检测', '图像识别', '人脸识别', '图像分割', '人脸', '人脸检测', '物体识别'],
    ['image-processing']),

  // ---------- 媒体 ----------
  cap('image-processing', '图像处理 / 编辑', 'Image processing',
    ['image-processing', 'image-editor', 'computer-graphics'],
    ['image processing', 'image editor', 'image manipulation', 'resize image', 'crop', 'watermark', 'photo editor', 'image compression', 'blur', 'background removal', 'image filter'],
    ['图片处理', '图像编辑', '打水印', '压缩图片', '图片裁剪', '打码', '马赛克', '去水印', '抠图', '图片压缩', '照片', '相册', '图片'],
    []),

  cap('video-processing', '视频处理 / 剪辑', 'Video processing',
    ['video-processing', 'video-editor', 'ffmpeg'],
    ['video processing', 'video editor', 'ffmpeg', 'transcode', 'mux', 'timeline', 'subtitle', 'frame extraction', 'video encoding', 'face blur', 'video conversion'],
    ['视频剪辑', '视频处理', '转码', '字幕', '视频编辑', '视频', '剪辑', '视频压缩', '视频合成', '视频打码'],
    ['image-processing', 'audio']),

  cap('audio', '音频处理', 'Audio',
    ['audio', 'audio-processing', 'dsp'],
    ['audio processing', 'dsp', 'sound', 'mixer', 'equalizer', 'waveform', 'mp3', 'audio synthesis'],
    ['音频处理', '混音', '音频分析'],
    []),

  cap('streaming', '流媒体 / 实时音视频', 'Streaming',
    ['streaming', 'webrtc', 'hls'],
    ['webrtc', 'rtmp', 'hls', 'live streaming', 'media server', 'sfu', 'video streaming'],
    ['直播', '推流', '实时音视频', '点播'],
    ['video-processing', 'audio']),

  cap('three-d', '三维 / 渲染', '3D & rendering',
    ['3d', 'rendering', 'threejs', 'opengl'],
    ['3d rendering', 'threejs', 'webgl', 'opengl', 'cad', 'mesh', 'shader', 'voxel', 'gltf'],
    ['三维', '建模', '渲染', 'CAD', '3D 引擎'],
    ['image-processing']),

  cap('game-engine', '游戏引擎', 'Game engine',
    ['game-engine', 'game-development', 'gamedev'],
    ['game engine', 'gamedev', 'game development', 'ecs', 'game framework'],
    ['游戏引擎', '游戏开发', '2D 引擎'],
    ['three-d', 'audio', 'physics']),

  cap('physics', '物理引擎', 'Physics',
    ['physics-engine', 'physics-simulation'],
    ['physics engine', 'collision detection', 'rigid body', 'physics simulation'],
    ['物理引擎', '碰撞检测', '物理模拟'],
    []),

  // ---------- 采集 / 网络 ----------
  cap('browser-automation', '浏览器自动化', 'Browser automation',
    ['browser-automation', 'puppeteer', 'playwright', 'headless-browser'],
    ['browser automation', 'headless browser', 'puppeteer', 'playwright', 'selenium', 'chromium', 'web automation'],
    ['浏览器自动化', '无头浏览器', '自动化操作网页', 'RPA'],
    ['scraping']),

  cap('scraping', '爬虫 / 数据抓取', 'Web scraping',
    ['scraper', 'scraping', 'crawler'],
    ['crawler', 'scraper', 'spider', 'web scraping', 'crawling', 'scrape website', 'data extraction'],
    ['爬虫', '抓取', '采集', '数据采集'],
    ['browser-automation', 'html-parser', 'http-client', 'proxy']),

  cap('html-parser', 'HTML / XML 解析', 'HTML & XML parsing',
    ['html-parser', 'xml'],
    ['html parser', 'dom', 'xml parser', 'css selector', 'cheerio', 'html parsing'],
    ['HTML 解析', '网页解析', 'XML 解析'],
    []),

  cap('http-client', 'HTTP 客户端', 'HTTP client',
    ['http-client', 'http'],
    ['http client', 'http library', 'rest client', 'curl', 'requests', 'http/2', 'http/3'],
    ['HTTP 请求', '网络请求', '接口调用'],
    []),

  cap('proxy', '代理 / 内网穿透', 'Proxy & tunnel',
    ['proxy', 'tunnel', 'nat-traversal'],
    ['proxy server', 'reverse proxy', 'tunnel', 'nat traversal', 'wireguard', 'vpn', 'frp', 'port forwarding'],
    ['代理', '内网穿透', '隧道', 'VPN', '反向代理'],
    ['networking']),

  cap('networking', '网络协议 / 网络库', 'Networking',
    ['networking', 'tcp', 'quic'],
    ['tcp', 'udp', 'quic', 'socket', 'packet', 'dns', 'network stack', 'packet capture'],
    ['网络协议', '抓包', '网络库', 'TCP'],
    []),

  // ---------- Web ----------
  cap('web-framework', 'Web 后端框架', 'Web backend',
    ['web-framework', 'backend', 'rest-api'],
    ['web framework', 'backend framework', 'rest api', 'http server', 'express', 'fastapi', 'graphql server'],
    ['后端框架', 'Web 框架', '接口服务', 'REST API'],
    ['database', 'auth']),

  cap('frontend', '前端框架 / UI 组件', 'Frontend & UI',
    ['frontend', 'ui-components', 'design-system'],
    ['frontend', 'react', 'vue', 'svelte', 'ui components', 'design system', 'component library', 'react components'],
    ['前端框架', 'UI 组件库', '组件库', '页面开发'],
    []),

  cap('ssr', '服务端渲染 / 建站', 'SSR & site generators',
    ['ssr', 'static-site-generator', 'nextjs'],
    ['server side rendering', 'static site generator', 'ssg', 'ssr', 'next.js', 'nuxt', 'blog engine'],
    ['服务端渲染', '静态站点', '建站', '博客系统'],
    ['frontend']),

  cap('chart', '数据可视化 / 图表', 'Data visualization',
    ['visualization', 'charts', 'dashboard'],
    ['chart', 'charting', 'visualization', 'dashboard', 'plotting', 'd3', 'echarts', 'graph rendering'],
    ['图表', '数据可视化', '大屏', '仪表盘'],
    []),

  // ---------- 数据存储 ----------
  cap('database', '数据库', 'Database',
    ['database', 'sql', 'storage-engine'],
    ['database', 'sql engine', 'storage engine', 'transactional', 'embedded database', 'btree', 'lsm tree', 'query optimizer'],
    ['数据库', '存储引擎', 'SQL 引擎'],
    []),

  cap('kv-store', '键值存储 / 缓存', 'Key-value & cache',
    ['key-value', 'cache', 'redis'],
    ['key value store', 'cache server', 'redis compatible', 'in-memory database', 'distributed cache'],
    ['缓存', '键值存储', 'Redis'],
    []),

  cap('search-engine', '全文检索', 'Full-text search',
    ['search-engine', 'full-text-search', 'lucene'],
    ['full text search', 'search engine', 'inverted index', 'elasticsearch', 'lucene', 'bm25', 'faceting'],
    ['全文搜索', '搜索引擎', '站内搜索', '搜索', '查找'],
    []),

  cap('message-queue', '消息队列 / 事件总线', 'Message queue',
    ['message-queue', 'kafka', 'mqtt', 'pubsub'],
    ['message queue', 'kafka', 'rabbitmq', 'pubsub', 'event bus', 'mqtt', 'message broker', 'stream processing'],
    ['消息队列', '事件总线', '发布订阅', 'MQ'],
    []),

  cap('job-scheduler', '任务调度 / 工作流', 'Scheduling & workflow',
    ['scheduler', 'cron', 'workflow-engine', 'job-queue'],
    ['job scheduler', 'cron', 'task queue', 'workflow engine', 'dag', 'orchestration', 'background jobs', 'distributed task'],
    ['定时任务', '任务调度', '工作流', '任务队列'],
    []),

  // ---------- 安全 / 身份 ----------
  cap('auth', '认证授权', 'Auth & identity',
    ['authentication', 'authorization', 'oauth', 'sso'],
    ['authentication', 'authorization', 'oauth', 'oidc', 'jwt', 'sso', 'rbac', 'login', 'identity provider', 'permissions'],
    ['登录', '认证', '鉴权', '单点登录', '权限管理'],
    ['crypto']),

  cap('crypto', '加密 / 密码学', 'Cryptography',
    ['cryptography', 'encryption', 'tls'],
    ['cryptography', 'encryption', 'cipher', 'tls', 'zero knowledge', 'hash', 'signature', 'key exchange'],
    ['加密', '密码学', '签名', '国密', '证书'],
    []),

  cap('sandbox', '沙箱 / 隔离', 'Sandbox & isolation',
    ['sandbox', 'isolation', 'container-runtime'],
    ['sandbox', 'isolation', 'seccomp', 'container runtime', 'jail', 'capability', 'untrusted code'],
    ['沙箱', '隔离', '容器运行时', '执行不可信代码'],
    ['virtualization']),

  cap('virtualization', '虚拟化 / 模拟器', 'Virtualization',
    ['virtualization', 'hypervisor', 'emulator'],
    ['hypervisor', 'virtual machine', 'emulator', 'qemu', 'kvm', 'x86 emulation', 'compatibility layer'],
    ['虚拟机', '模拟器', '虚拟化', '兼容层'],
    []),

  cap('wasm-runtime', 'WebAssembly 运行时', 'WASM runtime',
    ['wasm', 'webassembly', 'wasm-runtime'],
    ['webassembly', 'wasm', 'wasi', 'wasm runtime', 'wasm plugin'],
    ['WebAssembly', 'WASM', 'WASM 插件'],
    ['compiler']),

  // ---------- 语言 / 工具链 ----------
  cap('compiler', '编译器 / 语言实现', 'Compiler & interpreter',
    ['compiler', 'programming-language', 'llvm'],
    ['compiler', 'llvm', 'parser', 'lexer', 'type checker', 'code generation', 'transpiler', 'interpreter', 'programming language'],
    ['编译器', '语言实现', '解释器', '类型检查'],
    []),

  cap('cli-tool', '命令行工具', 'CLI & TUI',
    ['cli', 'command-line', 'terminal', 'tui'],
    ['command line tool', 'cli', 'tui', 'terminal ui', 'shell', 'command line interface'],
    ['命令行工具', '终端工具', 'CLI'],
    []),

  cap('editor', '代码编辑器 / IDE', 'Editor & IDE',
    ['editor', 'code-editor', 'ide', 'vscode-extension'],
    ['code editor', 'ide', 'vscode extension', 'language server', 'lsp', 'syntax highlighting', 'text editor', 'notebook'],
    ['代码编辑器', '编辑器插件', 'IDE', '语法高亮'],
    ['cli-tool']),

  cap('build-tool', '构建 / 打包', 'Build tooling',
    ['build-tool', 'bundler', 'monorepo'],
    ['build system', 'bundler', 'monorepo', 'task runner', 'make', 'compiler toolchain', 'dependency management'],
    ['构建工具', '打包', '工程化', 'Monorepo'],
    []),

  cap('testing', '测试框架', 'Testing',
    ['testing', 'test-framework', 'e2e-testing'],
    ['testing framework', 'unit test', 'e2e', 'mock', 'assertion', 'test runner', 'snapshot testing', 'load testing'],
    ['测试框架', '单元测试', '端到端测试', '压测'],
    []),

  // ---------- 运维 / 数据工程 ----------
  cap('observability', '监控 / 追踪 / 日志', 'Observability',
    ['observability', 'monitoring', 'tracing', 'metrics'],
    ['monitoring', 'tracing', 'metrics', 'opentelemetry', 'apm', 'logging', 'error tracking', 'alerting', 'profiling'],
    ['监控', '链路追踪', '日志', '告警', '指标'],
    []),

  cap('container', '容器 / 编排', 'Containers',
    ['docker', 'container', 'kubernetes'],
    ['docker', 'container', 'kubernetes', 'k8s', 'container image', 'container orchestration', 'helm'],
    ['容器', 'K8s', '容器编排', '镜像'],
    ['sandbox']),

  cap('ci-cd', 'CI/CD 与部署', 'CI/CD & deploy',
    ['ci-cd', 'continuous-integration', 'deployment'],
    ['ci cd', 'continuous integration', 'pipeline', 'deployment', 'devops', 'release automation', 'gitops'],
    ['持续集成', '部署', '流水线', '发布'],
    ['container', 'testing']),

  cap('data-pipeline', '数据管道 / ETL', 'Data pipeline',
    ['etl', 'data-pipeline', 'data-engineering'],
    ['etl', 'data pipeline', 'airflow', 'data engineering', 'ingestion', 'cdc', 'data sync', 'replication'],
    ['数据管道', '数据同步', 'ETL', '数据集成'],
    ['database', 'job-scheduler']),

  cap('dataframe', '数据分析 / 查询引擎', 'Dataframe & analytics',
    ['dataframe', 'data-analysis', 'olap', 'query-engine'],
    ['dataframe', 'data analysis', 'olap', 'sql query engine', 'columnar', 'arrow', 'parquet', 'analytics engine'],
    ['数据分析', '数据框', '查询引擎', 'OLAP'],
    []),

  cap('time-series', '时序数据库', 'Time-series DB',
    ['time-series', 'tsdb'],
    ['time series database', 'tsdb', 'metrics storage', 'influxdb', 'time series'],
    ['时序数据库', '指标存储'],
    ['database']),

  // ---------- 通信 / 其他 ----------
  cap('im', '即时通讯', 'Instant messaging',
    ['chat', 'instant-messaging', 'matrix'],
    ['instant messaging', 'chat server', 'matrix protocol', 'xmpp', 'chat application', 'messaging platform'],
    ['即时通讯', '聊天', 'IM', '聊天室'],
    ['websocket', 'database']),

  cap('websocket', '实时通信', 'Realtime transport',
    ['websocket', 'realtime'],
    ['websocket', 'realtime', 'socket io', 'server sent events', 'long polling', 'push notification'],
    ['实时通信', '长连接', 'WebSocket', '消息推送'],
    ['networking']),

  cap('gpu-compute', 'GPU / 异构计算', 'GPU compute',
    ['cuda', 'gpu', 'rocm', 'opencl'],
    ['cuda', 'gpu compute', 'opencl', 'rocm', 'tensor', 'accelerator', 'simd'],
    ['GPU 计算', 'CUDA', '并行计算'],
    []),

  cap('embedded', '嵌入式 / IoT', 'Embedded & IoT',
    ['embedded', 'iot', 'firmware'],
    ['embedded', 'firmware', 'iot', 'arduino', 'esp32', 'rtos', 'microcontroller', 'robotics'],
    ['嵌入式', '物联网', '单片机', '固件'],
    []),

  cap('os-kernel', '操作系统 / 内核', 'OS & kernel',
    ['kernel', 'operating-system', 'bootloader'],
    ['kernel', 'operating system', 'bootloader', 'unikernel', 'syscall', 'driver', 'hypervisor'],
    ['操作系统', '内核', '引导程序'],
    []),

  cap('filesystem', '文件系统 / 对象存储', 'Filesystem & storage',
    ['filesystem', 'fuse', 'object-storage'],
    ['filesystem', 'fuse', 'file system', 'storage layer', 'object storage', 's3 compatible', 'distributed storage'],
    ['文件系统', '对象存储', '分布式存储'],
    []),

  cap('git-tool', 'Git / 版本控制', 'Git tooling',
    ['git', 'version-control', 'diff'],
    ['git tool', 'version control', 'diff', 'merge', 'git client', 'git server', 'code hosting'],
    ['Git 工具', '版本控制', '差异对比', '代码托管'],
    []),

  cap('code-analysis', '代码分析 / 静态检查', 'Code analysis',
    ['static-analysis', 'linter', 'code-quality'],
    ['static analysis', 'linter', 'linting', 'code quality', 'ast', 'refactoring', 'code review', 'sast', 'type inference'],
    ['静态分析', '代码检查', '代码审查', 'Lint'],
    []),

  cap('security-tool', '安全 / 渗透测试', 'Security tooling',
    ['security', 'penetration-testing', 'vulnerability'],
    ['penetration testing', 'vulnerability scanner', 'exploit', 'ctf', 'red team', 'security scanner', 'fuzzing', 'reverse engineering'],
    ['渗透测试', '漏洞扫描', '安全工具', '逆向', 'Fuzz'],
    ['networking', 'crypto']),
];

export const CAP_BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

/** 采集用的查询：每个能力取前两个 topic，去重 */
export function collectQueries({ topicsPerCap = 1 } = {}) {
  const seen = new Set();
  const out = [];
  for (const c of CAPABILITIES) {
    for (const topic of c.topics.slice(0, topicsPerCap)) {
      if (seen.has(topic)) continue;
      seen.add(topic);
      out.push({ cap: c.id, topic, q: `topic:${topic} stars:>30` });
    }
  }
  return out;
}
