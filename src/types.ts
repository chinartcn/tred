export interface AstSelector {
  kind: 'class' | 'function' | 'arrow-function' | 'method' | 'statement' | 'variable' | 'property';
  className?: string;
  functionName?: string;
  methodName?: string;
  variableName?: string;
  /** property 的路径，如 "TECHS.铁矿机.cost" */
  path?: string;
  /** 如果有多个匹配，指定第几个（1-based），默认 1 */
  occurrence?: number;
  /** v2.8.0: 开启向量模糊匹配 */
  fuzzy?: boolean;
  /** v3.0.0: 上下文过滤，如 worker.onmessage */
  context?: string;
}

export interface SnippetSelector {
  /** 按行范围 */
  startLine?: number;
  endLine?: number;
  /** 按文本片段（包含该片段的行开始/结束） */
  startSnippet?: string;
  endSnippet?: string;
  /** 有多处匹配时，取第几个，默认 1 */
  occurrence?: number;
  /** v2.5.0: 强制从 start 切到文件末尾（救急残留代码） */
  cutToEnd?: boolean;
}

export type Formatter = (source: string, file: string) => string | Promise<string>;

// v2.5.0: 文件级切分
export interface FileSelector {
  kind: 'file';
  scope: 'head' | 'tail' | 'all';
  line?: number;
  snippet?: string;
}

export interface ReplaceAssertions {
  /** 新内容必须包含这些文本 */
  include?: string[];
  /** 新内容必须不包含这些文本 */
  exclude?: string[];
  /** 新内容必须匹配这些正则（字符串形式） */
  regex?: string[];
  /** 替换后代码必须包含特定的 AST 节点，如 "method:run" */
  hasAst?: string[];
  /** 替换后代码不能包含特定的 AST 节点，如 "variable:oldVar" */
  noAst?: string[];
}

export interface ReplaceOptions {
  /** 智能断言：写盘前对即将替换的代码进行特征校验 */
  assertions?: ReplaceAssertions;
  /** 模糊匹配：忽略锚点名大小写，允许冒号前后无空格 */
  fuzzy?: boolean;
  file: string;
  anchor: string;
  content: string;
  fingerprint: string;
  autoInjectAnchor?: boolean;
  astSelector?: AstSelector;
  /** v2.0.0: 通用选择器，供多语言 Parser 使用 */
  selector?: any;
  snippetSelector?: SnippetSelector;
  dryRun?: boolean;
  format?: Formatter;
}

export type ReplaceStatus = 'replaced' | 'skipped' | 'injected' | 'failed';

export interface FailureContext {
  oldCode: string;
  newCode: string;
}

export interface ReplaceResult {
  status: ReplaceStatus;
  file: string;
  anchor: string;
  message?: string;
  syntaxErrors?: string[];
  diff?: string;
  failureContext?: FailureContext;
}

export type BatchStatus = 'committed' | 'rolled-back' | 'dry-run' | 'partial';

export interface BatchResult {
  status: BatchStatus;
  results: ReplaceResult[];
  committedFiles: string[];
  error?: string;
}

export type OutlineKind =
  | 'class'
  | 'function'
  | 'method'
  | 'constructor'
  | 'property'
  | 'getter'
  | 'setter';

export interface OutlineNode {
  kind: OutlineKind;
  name: string;
  line: number;
  column: number;
  start: number;
  end: number;
  selector?: AstSelector;
  children?: OutlineNode[];
}

// v0.5: verify
export interface VerifyAnchorEntry {
  name: string;
  line: number;
  endLine: number;
  fp: string | null;
}

export interface VerifyOrphan {
  name: string;
  line: number;
  kind: 'start' | 'end';
}

export interface VerifyFileReport {
  file: string;
  anchors: VerifyAnchorEntry[];
  orphans: VerifyOrphan[];
}

export interface VerifyDuplicateWithin {
  file: string;
  name: string;
  lines: number[];
}

export interface VerifyDuplicateAcross {
  name: string;
  entries: { file: string; line: number; fp: string | null }[];
}

export interface VerifyFingerprintMismatch {
  name: string;
  entries: { file: string; line: number; fp: string | null }[];
}

export interface VerifyIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface VerifyReport {
  ok: boolean;
  dir: string;
  scannedFiles: number;
  files: VerifyFileReport[];
  issues: VerifyIssue[];
  duplicatesWithin: VerifyDuplicateWithin[];
  duplicatesAcross: VerifyDuplicateAcross[];
  fingerprintMismatches: VerifyFingerprintMismatch[];
  /** 仅 cache 启用时返回 */
  cacheStats?: VerifyCacheStats;
}

// v0.7: verify --fix
export type FixActionKind = 'delete-orphan-end' | 'add-orphan-end';

export interface FixAction {
  kind: FixActionKind;
  line: number;
  anchorName: string;
  description: string;
}

export interface FixFileResult {
  file: string;
  actions: FixAction[];
  diff: string;
  applied: boolean;
  error?: string;
}

export interface FixOptions {
  dir: string;
  apply?: boolean;
  extensions?: string[];
  ignore?: Set<string>;
  /** opt-in：尝试补全孤儿 START 的 END（AST 定位，默认关闭） */
  fixOrphanStart?: boolean;
  /** 启用增量缓存（.tred-cache/verify.json） */
  cache?: boolean;
  /** 缓存目录，默认 .tred-cache（相对 cwd） */
  cacheDir?: string;
}

export interface FixRemainingOrphan {
  file: string;
  line: number;
  anchorName: string;
  kind: 'start' | 'end';
}

export interface FixReport {
  ok: boolean;
  dryRun: boolean;
  dir: string;
  scannedFiles: number;
  files: FixFileResult[];
  totalActions: number;
  /** 修复后仍无法自动处理的孤儿 START（只报告，不修） */
  remainingOrphanStarts: FixRemainingOrphan[];
  error?: string;
}

// v0.11: verify --cache
export interface VerifyCacheEntry {
  mtimeMs: number;
  size: number;
  /** null 表示无锚点（省空间） */
  file: VerifyFileReport | null;
}

export interface VerifyCache {
  version: 1;
  entries: Record<string, VerifyCacheEntry>;
}

export interface VerifyCacheStats {
  enabled: boolean;
  hits: number;
  misses: number;
  removed: number;
}

// v0.12: replace-many --rollback-log
export interface ReplaceManyOptions {
  /** 提交阶段失败时，写一份 JSON 审计日志到该路径 */
  rollbackLog?: string;
  /** 单文件失败时是否继续处理其他文件（默认 false：立即全量回滚） */
  continueOnError?: boolean;
  /** @internal 测试用：替换 atomicWrite 模拟写盘失败，生产路径留空 */
  _writer?: (file: string, content: string) => void;
}

export interface RollbackLog {
  /** ISO 8601 时间戳 */
  timestamp: string;
  status: 'rolled-back';
  /** 触发回滚的原始错误消息 */
  error: string;
  commitPhase: {
    /** pending 中的所有文件（按提交顺序） */
    attempted: string[];
    /** 已经写成功但被回滚的文件 */
    committed: string[];
    /** 触发失败的那个文件，若无法确定则为 null */
    failed: string | null;
    /** 回滚本身失败的文件（磁盘满 / 权限被改等） */
    rollbackErrors: { file: string; message: string }[];
  };
  /** 每个 op 的最终 compute 结果（含 diff 便于回溯） */
  ops: ReplaceResult[];
}

// v0.14: tred diff --anchor
export interface DiffAnchorOptions {
  anchor: string;
  /** 左侧文件 */
  left: string;
  /** 右侧文件 */
  right: string;
}

export interface DiffAnchorSide {
  file: string;
  found: boolean;
  /** 锚点块内部内容（不含 START/END 注释行），未找到为 null */
  content: string | null;
  /** 1-based，START 行的下一行 */
  startLine: number | null;
  /** 1-based，END 行 */
  endLine: number | null;
}

export interface DiffAnchorResult {
  ok: boolean;
  anchor: string;
  left: DiffAnchorSide;
  right: DiffAnchorSide;
  /** unified diff；两侧内容相同时为空字符串 */
  diff: string;
  message?: string;
}

// v0.15: tred diff --dir
export interface DiffDirOptions {
  leftDir: string;
  rightDir: string;
  extensions?: string[];
  ignore?: Set<string>;
  anchorFilter?: string;
  /** 只处理 git 改动过的文件（--since 时使用） */
  since?: string;
  /** 显式指定改动文件列表（--since-file 时使用） */
  changedFiles?: string[];
}

export interface DiffDirAnchorResult {
  name: string;
  leftFound: boolean;
  rightFound: boolean;
  /** 空 = 无差异 */
  diff: string;
  message?: string;
}

export interface DiffDirFileResult {
  file: string;
  leftExists: boolean;
  rightExists: boolean;
  anchors: DiffDirAnchorResult[];
}

export interface DiffDirStats {
  compared: number;
  unchanged: number;
  changed: number;
  missing: number;
}

export interface DiffDirResult {
  ok: boolean;
  leftDir: string;
  rightDir: string;
  files: DiffDirFileResult[];
  stats: DiffDirStats;
}

// v0.15: tred annotate
export interface AnnotateOptions {
  file: string;
  classes?: boolean;
  methods?: boolean;
  functions?: boolean;
  apply?: boolean;
}

export interface AnnotateAction {
  name: string;
  kind: 'start' | 'end';
  nodeKind: 'class' | 'method' | 'function';
  line: number;
}

export interface AnnotateResult {
  ok: boolean;
  file: string;
  actions: AnnotateAction[];
  diff: string;
  applied: boolean;
  syntaxErrors?: string[];
}

// v0.16: tred annotate --dir
export interface AnnotateDirOptions {
  dir: string;
  classes?: boolean;
  methods?: boolean;
  functions?: boolean;
  apply?: boolean;
  extensions?: string[];
  ignore?: Set<string>;
  /** v0.19: files 数组排序 */
  order?: 'source' | 'name' | 'kind';
  /** v0.17: 只处理 git 改动文件 */
  since?: string;
  /** v0.18: 从文件读取改动列表 */
  sinceFile?: string;
  /** v0.17: glob 排除列表 */
  exclude?: string[];
}

export interface AnnotateDirResult {
  ok: boolean;
  dir: string;
  apply: boolean;
  files: AnnotateResult[];
  totalActions: number;
  annotatedFiles: number;
  failedFiles: number;
}

// v0.17: --since / --exclude / --format
export interface SinceOption {
  /** git ref（HEAD~5 / main / <sha>），仅处理改动文件 */
  since?: string;
}

export interface ExcludeOption {
  /** glob 排除列表，如 ['*.test.ts', 'scripts/**'] */
  exclude?: string[];
}

export interface FormatOption {
  /** text（默认）| markdown（PR 注释用） */
  format?: 'text' | 'markdown';
}
// v0.18: doctor + since-file
export interface SinceFileOption {
  /** 从文件读取改动列表（每行一个相对路径），CI 环境用 */
  sinceFile?: string;
}

export interface DoctorOptions {
  dir?: string;
  json?: boolean;
}

export interface DoctorGitInfo {
  available: boolean;
  isRepo: boolean;
  branch: string | null;
  head: string | null;
  dirty: boolean;
  changedFiles: number;
}

export interface DoctorCacheInfo {
  exists: boolean;
  entries: number;
  sizeBytes: number;
  path: string;
}

export interface DoctorAnchorInfo {
  files: number;
  total: number;
  issues: number;
  errors: number;
  warnings: number;
}

export interface DoctorDepsInfo {
  tsx: boolean;
  prettier: boolean;
}

export interface DoctorReport {
  ok: boolean;
  tredVersion: string;
  packageVersion: string;
  nodeVersion: string;
  platform: string;
  dir: string;
  git: DoctorGitInfo;
  cache: DoctorCacheInfo;
  anchors: DoctorAnchorInfo;
  deps: DoctorDepsInfo;
  suggestions: string[];
}

// v0.19: baseline / check / init
export interface BaselineIssue {
  code: string;
  file?: string;
  line?: number;
  message: string;
  level: 'error' | 'warning';
}

export interface BaselineFile {
  version: 1;
  createdAt: string;
  dir: string;
  issues: BaselineIssue[];
}

export interface InitOptions {
  dir?: string;
  withHook?: boolean;
}

export interface InitResult {
  ok: boolean;
  configPath: string;
  hookPath: string | null;
  created: string[];
  skipped: string[];
  errors: string[];
}

// v0.20: watch / diff-from
export interface WatchOptions {
  dir: string;
  strict?: boolean;
  format?: 'text' | 'markdown' | 'github-annotations';
  debounceMs?: number;
}

export interface DiffFromOption {
  diffFrom?: string;
}
