#!/usr/bin/env bash
# 信奥互动课件工作流：Codex 项目一键安装
#
# 在 Codex 图形界面打开的项目根目录里放入本脚本，然后执行：
#   bash bootstrap-codex-courseware.sh
#
# 脚本会：检查 Node/git → 安装 Spec Kit CLI（如缺失）→ 克隆模板 →
# 初始化 git → 安装 workflow/preset → 安装工具依赖 → 准备 Chromium →
# 跑 smoke 和 workflow 校验。
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_REPO="${COURSEWARE_TEMPLATE_REPO:-file://$HOME/code/courseware-workflow-template}"
TEMPLATE_REF=""
TARGET="$SCRIPT_DIR"
INTEGRATION="codex"
WITH_BROWSER=1
FORCE=0

usage() {
  cat <<'EOF'
用法: bash bootstrap-codex-courseware.sh [选项]

选项:
  --repo <url|path>       模板仓库（默认: 本机 courseware-workflow-template）
  --ref <branch|tag>      模板分支或标签（默认: 默认分支）
  --target <dir>          安装到指定项目目录（默认: 脚本所在目录）
  --integration <name>    安装的集成，codex 或 claude（默认: codex）
  --no-browser            跳过 Playwright Chromium 下载/检测
  --force                 覆盖已有 workflow/（默认保留）
  -h, --help              显示帮助

环境变量:
  COURSEWARE_TEMPLATE_REPO  覆盖默认模板仓库
  CHROME_PATH               指定 Chrome/Chromium 可执行文件

示例:
  bash bootstrap-codex-courseware.sh
  bash bootstrap-codex-courseware.sh --repo https://example.com/courseware-template.git
EOF
}

die() { printf '\n错误: %s\n' "$*" >&2; exit 1; }
log() { printf '\n== %s\n' "$*"; }

while (($# > 0)); do
  case "$1" in
    --repo)
      [[ $# -ge 2 ]] || die "--repo 需要参数"
      TEMPLATE_REPO="$2"
      shift 2
      ;;
    --ref)
      [[ $# -ge 2 ]] || die "--ref 需要参数"
      TEMPLATE_REF="$2"
      shift 2
      ;;
    --target)
      [[ $# -ge 2 ]] || die "--target 需要参数"
      TARGET="$2"
      shift 2
      ;;
    --integration)
      [[ $# -ge 2 ]] || die "--integration 需要参数"
      INTEGRATION="$2"
      shift 2
      ;;
    --no-browser)
      WITH_BROWSER=0
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数: $1（用 --help 查看）"
      ;;
  esac
done

[[ "$INTEGRATION" == "codex" || "$INTEGRATION" == "claude" ]] ||
  die "--integration 只能是 codex 或 claude"

mkdir -p "$TARGET"
TARGET="$(cd -- "$TARGET" && pwd)"

log "检查依赖"
command -v node >/dev/null 2>&1 || die "未找到 node。安装 Node.js >= 18 后重试。"
command -v npm >/dev/null 2>&1 || die "未找到 npm。安装 Node.js >= 18 后重试。"
command -v git >/dev/null 2>&1 || die "未找到 git。安装 Git 后重试。"
node -e 'const major = Number(process.versions.node.split(".")[0]); if (major < 18) { console.error(process.versions.node); process.exit(1) }' ||
  die "需要 Node.js >= 18，当前: $(node --version)"
printf 'Node %s / npm %s / git %s\n' "$(node --version)" "$(npm --version)" "$(git --version | awk '{print $3}')"

if ! command -v specify >/dev/null 2>&1; then
  log "安装 Spec Kit CLI"
  if command -v uv >/dev/null 2>&1; then
    uv tool install specify-cli
  elif command -v pipx >/dev/null 2>&1; then
    pipx install specify-cli
  else
    die "未找到 Spec Kit CLI，也未找到 uv/pipx。先安装 uv（https://docs.astral.sh/uv/）或 pipx，再重跑。"
  fi
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi
command -v specify >/dev/null 2>&1 ||
  die "specify 仍未在 PATH 中；把 ~/.local/bin 加入 PATH 后重跑。"
printf 'Spec Kit: %s\n' "$(specify --version 2>/dev/null || echo unknown)"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/courseware-template.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

log "获取模板: $TEMPLATE_REPO"
clone_args=(--depth 1)
[[ -n "$TEMPLATE_REF" ]] && clone_args+=(--branch "$TEMPLATE_REF")
git clone "${clone_args[@]}" "$TEMPLATE_REPO" "$TMP/template"
[[ -f "$TMP/template/workflow/install.mjs" ]] ||
  die "模板不完整：缺少 workflow/install.mjs"

log "准备项目: $TARGET"
if [[ ! -d "$TARGET/.git" ]]; then
  git -C "$TARGET" init -q
  printf '已 git init（Codex 需要可信任的 git 目录）\n'
fi
if [[ ! -f "$TARGET/.gitignore" ]]; then
  cp "$TMP/template/project.gitignore" "$TARGET/.gitignore"
  printf '已写入 .gitignore\n'
else
  printf '.gitignore 已存在，保留；请确认忽略 workflow/tools/node_modules/、workflow/tools/chrome-path.txt、.specify/workflows/runs/ 等\n'
fi
if [[ ! -f "$TARGET/AGENTS.md" ]]; then
  cp "$TMP/template/AGENTS.md" "$TARGET/AGENTS.md"
  printf '已写入 AGENTS.md\n'
else
  printf 'AGENTS.md 已存在，保留\n'
fi

log "安装 workflow / preset"
install_args=(--project "$TARGET" --integration "$INTEGRATION" --skip-deps --no-smoke)
[[ $FORCE -eq 1 ]] && install_args+=(--force)
node "$TMP/template/workflow/install.mjs" "${install_args[@]}"

log "安装工具依赖"
(
  cd "$TARGET/workflow/tools"
  npm ci --no-audit --no-fund
)

cat > "$TMP/detect-chrome.mjs" <<'JS'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const [modulePath, outPath] = process.argv.slice(2)
const { resolveChrome } = await import(pathToFileURL(modulePath).href)
const chrome = resolveChrome()
if (!chrome) process.exit(1)
fs.writeFileSync(outPath, chrome + '\n')
console.log(chrome)
JS

detect_chrome() {
  node "$TMP/detect-chrome.mjs" \
    "$TARGET/workflow/tools/chrome.mjs" \
    "$TARGET/workflow/tools/chrome-path.txt"
}

if [[ $WITH_BROWSER -eq 1 ]]; then
  log "检查 Chromium"
  if detect_chrome; then
    printf 'Chromium 已就绪\n'
  else
    log "安装 Playwright Chromium（约 150MB，只需一次）"
    (
      cd "$TARGET/workflow/tools"
      ./node_modules/.bin/playwright-core install chromium
    )
    detect_chrome || die "Chromium 安装后仍未找到。设置 CHROME_PATH 后重跑，或加 --no-browser 跳过。"
  fi
else
  printf '跳过 Chromium（--no-browser）；之后可运行: cd workflow/tools && ./node_modules/.bin/playwright-core install chromium\n'
fi

if [[ -d "$TARGET/.specify" ]]; then
  if ! specify integration status --json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.exit(j.installed_integrations.includes("codex")?0:1)}catch{process.exit(1)}})'; then
    log "为已有 Spec Kit 项目补装 Codex 集成"
    (cd "$TARGET" && specify integration install codex)
  fi
fi

log "验证安装"
[[ -f "$TARGET/.agents/skills/speckit-script/SKILL.md" ]] ||
  die "Codex skill 未生成：缺少 .agents/skills/speckit-script/SKILL.md"
[[ -f "$TARGET/AGENTS.md" ]] || die "缺少 AGENTS.md"
node "$TARGET/workflow/tools/smoke-test.mjs"
(
  cd "$TARGET"
  specify workflow info courseware-production
)

log "完成"
cat <<EOF
项目:     $TARGET
集成:     $INTEGRATION
工作流:   workflow/workflows/courseware-production.yml
技能:     .agents/skills/（Codex 中用 \$speckit-* 调用）
说明:     AGENTS.md

下一步:
  1. 在 Codex 中重新打开该项目，或执行 Force Reload Skills，确认能看到 speckit-* 技能。
  2. 本模板只含工作流，不含具体课件的壳、注册表、研究资料和插画；把本项目的 shell/style pack 放到 shells/ 后再跑完整流程。
  3. 完整流程示例见 AGENTS.md；Codex 中运行 specify workflow run 时加 -i integration=codex 和 </dev/null。
  4. 更新工作流: bash bootstrap-codex-courseware.sh --force
EOF
