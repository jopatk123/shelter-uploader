# 福州沿海码头避风点点位素材上传管理系统

福州沿海 141 个码头避风点点位的现场素材归集工具。

## 功能

- **作业上传页（/）**：无密码公开访问，选择点位后通过点击或拖放上传图片/视频；素材墙支持图片缩略图预览与灯箱查看、视频在线播放（Range 流式），并支持对已上传素材的**删除**（确认弹窗防误删）与**替换**（先传新素材、成功后删旧素材，任一步失败均不丢失旧素材）
- **管理后台（/admin）**：密码或 API Token 校验进入，查看/下载/删除素材，图片预览与视频在线播放
  - 批量下载：按素材类型打包下载（图片 / 视频 / 图片+视频混装，支持选中点位或全部点位）；zip 内按点位分文件夹，同一点位内按 `img_序号` / `video_序号` 编号
  - 统计表格导出：一键导出 CSV 统计表（含名称、区县、乡镇、船管站、经纬度、图片数/视频数、完成状态等）。完成状态与页面圆点一致：图片和视频都有为「已完成」，只有一种为「部分完成」
- 图片支持 JPG / PNG / WEBP，**不限制上传数量与像素比例**；超过压缩目标（默认 500KB）的图片在浏览器内压缩到目标以内：按体积估算安全分辨率后再降画质（避免手机原图撑爆画布），PNG/WEBP 会转成 JPG。原 JPEG 的 EXIF（含 GPS）在不超过目标体积时保留
- 图片纯黑像素占比 ≤ 10%（前端 Canvas 采样校验，防止全黑/损坏图）
- 图片上传成功后若无 EXIF GPS 经纬度，弹窗提示用户尽量上传相机/手机原图（勿经微信/QQ 转发）
- 视频仅 MP4、时长 ≥ 5 秒，**不限制上传数量**，单文件上限 80MB（可通过环境变量 VIDEO_MAX_SIZE_MB 配置），分片上传
- 服务端对单文件大小、分片数量与分片序号连续性做二次校验（图片硬上限默认 600KB，可用 IMAGE_MAX_SIZE_KB 配置），并对登录、上传与公开删除接口做按 IP 限流，防止绕过前端刷盘或脚本批量清库
- 前端分片上传带单片超时与自动重试（网络抖动/服务端 5xx 时自动重试，4xx 参数错误直接失败），提升弱网下大视频上传成功率
- 统一安全响应头（helmet：CSP / nosniff / frameguard / HSTS），密码校验使用恒定时间比较，JWT 固定 HS256 算法
- SQLite 嵌入式数据库，Docker 一键部署（容器以非 root 用户运行）

## 技术栈

| 层       | 技术                                         |
| -------- | -------------------------------------------- |
| 前端     | React 18 + Tailwind CSS 3 + Vite 6 + zustand |
| 后端     | Node.js 22 + Express 4 + better-sqlite3      |
| 数据库   | SQLite（WAL 模式）                           |
| 鉴权     | JWT（管理后台）；可选长期 API Token          |
| 文件上传 | multer（memoryStorage） + 分片上传           |
| 部署     | Docker + docker-compose                      |

## 本地开发

> 需要 **Node.js 22**（better-sqlite3 11.x 无法在 Node 26+ 下编译，CI 与 Docker 同样锁定 22）。
> 仓库已提供 `.nvmrc`（`nvm use` 即可切换），`pnpm dev` 也会因 `engines` 声明在版本不符时报错。

```bash
pnpm install
cp .env.example .env
# 编辑 .env，至少填写 ADMIN_PASSWORD 与 JWT_SECRET（缺失将阻断启动）
pnpm dev
```

也可使用一键脚本，它会自动切换到本机已安装的 Node 22（Homebrew `node@22` / nvm），版本不符时直接给出提示：

```bash
./start.sh
```

前端 <http://localhost:5173/> ，后端 <http://localhost:3001/>

> 管理员凭据（`ADMIN_PASSWORD`、`JWT_SECRET`）为**必填项**，不再提供内置默认值：
> 未配置时服务会直接退出并提示缺失的变量，避免以公开默认口令对外运行。
> JWT 密钥可使用 `openssl rand -hex 32` 生成。

## 测试

本仓库测试分三层，前两者由 Vitest 统一执行（Node 环境），第三层为手动脚本。

```bash
# 运行单元 + 接口测试
pnpm test

# 带覆盖率
pnpm test:coverage

# Lint 检查
pnpm lint

# 类型检查
pnpm check

# 格式化
pnpm format
```

### 上传页 UI 冒烟（手动，需本机已启动前后端）

前端组件目前**尚未接入 jsdom / testing-library**，无法在 Vitest 中渲染。
`tests/ui-smoke.mjs` 用 CDP 驱动本机 headless Chrome，对上传页容易被后续改动破坏的 UI 契约做回归：

- 未选择点位时上传区是引导式空状态（含 CTA），而非整块半透明
- 上传限制只以拖放区提示与失败提示呈现，面板顶部不再重复罗列徽标
- 文件输入可被键盘聚焦（视觉隐藏而非 `display:none`），拖放入口存在
- 点位信息区与上传区为近似 1:1 双栏
- 素材墙默认展开、点击标题可折叠
- 顶栏不再与点位总览重复展示同一个完成百分比

```bash
# 前提：前端 http://localhost:5173 与后端 http://localhost:3001 已在运行
pnpm test:ui-smoke

# 自定义地址 / 浏览器路径
BASE_URL=http://127.0.0.1:5173 pnpm test:ui-smoke
CHROME_PATH=/path/to/chrome pnpm test:ui-smoke
```

## Docker 部署

```bash
# 1. 复制并配置 .env（必须填写 ADMIN_PASSWORD 与 JWT_SECRET，否则启动会被阻断）
cp .env.example .env
# 2. 一键启动（对外端口 15000）
docker-compose up -d --build

# 3. 访问
# 上传页面: http://服务器IP:15000/
# 管理后台: http://服务器IP:15000/admin

# 查看日志
docker logs -f shelter-uploader

# 停止
docker-compose down

# 项目结束清理全部数据
docker-compose down
rm -rf data/
```

> **容器以非 root 用户运行**（镜像内 `node` 用户，UID/GID 1000）。
> 宿主机挂载的 `./data` 目录需可被 UID 1000 写入：若以 root 身份首次执行 `docker-compose up`
> 导致 `data/` 由 root 创建，容器会因无法写数据库而反复重启，执行一次
> `sudo chown -R 1000:1000 ./data` 后 `docker-compose restart` 即可。
>
> **公网部署检查清单**：
>
> - 生成强口令与强密钥（`openssl rand -hex 32`）；`ADMIN_PASSWORD` 命中常见弱口令或
>   `JWT_SECRET` 长度不足 32 时，启动日志会打印告警
> - 建议前置 Nginx 做 HTTPS 终结，并设置 `TRUST_PROXY=1`（只信任一层代理），
>   使登录/上传/删除限流按真实客户端 IP 生效。直连 `IP:端口` 时不要打开
> - 管理后台登录会话有效期 24 小时。重启容器不会使已签发的会话失效；
>   需要立即作废时，更换 `JWT_SECRET` 后再重启
> - 可选 `API_TOKEN` 是长期凭证，不随会话过期。作废方式是改掉该变量并重启。
>   不要把它写进前端代码或提交到仓库
> - 运行中数据库损坏时，进程会退出并由 `restart: unless-stopped` 拉起，
>   启动阶段再做坏库降级恢复。仅标记为 unhealthy 不会重启容器

## 配置说明（.env）

| 变量                     | 说明                                        | 是否必填 | 默认值            |
| ------------------------ | ------------------------------------------- | -------- | ----------------- |
| ADMIN_PASSWORD           | 管理员密码                                  | ✅ 必填  | 无                |
| JWT_SECRET               | JWT 密钥（建议随机字符串）                  | ✅ 必填  | 无                |
| API_TOKEN                | Agent 长期凭证，权限与管理员相同            | 可选     | 空（不启用）      |
| PORT                     | 后端服务端口                                | 可选     | 3001              |
| VITE_PORT                | 前端开发端口（vite）                        | 可选     | 5173              |
| DOCKER_PORT              | Docker 对外端口（映射到容器 3001）          | 可选     | 15000             |
| CHUNK_SIZE               | 分片大小（MB）                              | 可选     | 5                 |
| VIDEO_MAX_SIZE_MB        | 视频单文件大小上限（MB）                    | 可选     | 80                |
| IMAGE_MAX_SIZE_KB        | 图片单文件大小上限（KB，硬上限）            | 可选     | 600               |
| IMAGE_COMPRESS_TARGET_KB | 前端图片压缩目标（KB）                      | 可选     | 500               |
| CORS_ORIGIN              | 跨域来源白名单（逗号分隔）                  | 可选     | 空（不启用 CORS） |
| DATA_DIR                 | 数据存储目录（Docker 自动注入）             | 可选     | ./data            |
| TRUST_PROXY              | 前置反向代理时设为 1，限流使用真实客户端 IP | 可选     | 关闭              |

> 分片大小、视频上限与图片压缩目标都会通过 `GET /api/config` 下发给前端，前端不再硬编码，修改 `CHUNK_SIZE` / `VIDEO_MAX_SIZE_MB` / `IMAGE_COMPRESS_TARGET_KB` 后前后端阈值自动保持一致。
> `IMAGE_COMPRESS_TARGET_KB`（默认 500KB）是前端压缩目标，`IMAGE_MAX_SIZE_KB`（默认 600KB）是服务端硬上限：两者刻意留出 100KB 冗余，极端图片压缩后略微超标也不会被误杀，硬上限仅用于拦截绕过前端直接调用接口的超大文件。
> 前后端同源部署时无需配置 `CORS_ORIGIN`，留空即不返回 CORS 头，避免任意站点跨域调用接口。
>
> **API Token（给 Agent / 脚本）**：在 `.env` 设置 `API_TOKEN`（建议 `openssl rand -hex 32`）后重启。
> 请求头 `Authorization: Bearer <API_TOKEN>` 与登录后的管理员会话权限相同，可调用全部管理接口，包括：
>
> - `GET /api/admin/points`、`GET /api/admin/point/:id`：点位总览与详情
> - `GET /api/admin/download/:id`、`DELETE /api/admin/material/:id`：下载、删除素材
> - `GET /api/admin/batch-download`、`GET /api/admin/stats-csv`：批量打包与统计表（可直接带 Bearer，不必再换一次性票据）
> - `GET /storage/...`：管理端素材预览
>
> 管理后台页面也可以在登录框里粘贴同一个 Token（服务端会换成 24 小时会话）。上传页（`/api/points`、`/api/upload`）本来就是公开的，作业上传、查看和删除素材不需要 Token。
>
> **限流说明**：管理员登录按 IP 限制为 15 分钟 20 次（用 API Token 换会话同样计入）；上传接口按 IP 限制为 1 分钟 1800 次；公开删除素材按 IP 限制为 1 分钟 30 次（防止脚本遍历素材 id 批量清库）。
> 限流以 `req.ip` 为维度。直连（`IP:15000`）时不要设置 `TRUST_PROXY`。前置 Nginx 时在 `.env` 中设置 `TRUST_PROXY=1`，否则所有请求会被当成代理自己的 IP。

## 数据目录

```text
data/
├── db.sqlite       # SQLite 数据库
├── temp_chunk/     # 分片临时缓存（自动清理7天过期）
└── storage/        # 素材文件存储
    └── point_1/    # 按点位分目录
        ├── img_*.jpg
        └── video_*.mp4
```

## 点位数据

141 个点位来自市海洋与渔业局提供的《福州沿海码头避风点点位.xlsx》（WGS84 坐标系），
字段：序号、名称、市、县（市、区）、乡（镇、街道）、位置、船管站、可停泊数量、经度、纬度、备注。
数据固化在 [api/points-data.ts](api/points-data.ts)（按序号拆分存放于 `api/data/`，避免单文件过大），服务启动时自动导入数据库。
其中序号 058「石壁三级渔港」原表乡镇/船管站字段为空，界面显示为「—」，待主管部门补充。

## 项目结构

```text
api/                  # 后端 Express 应用
├── data/             # 点位源码数据（按序号拆分）
├── middleware/       # 鉴权中间件
├── routes/           # API 路由（points/upload/admin）
├── utils/            # 时间、图片尺寸、视频时长、点位统计工具
├── config.ts         # 环境变量集中读取与校验（含 .env 加载、必填项阻断）
├── app.ts            # 应用入口
├── db.ts             # SQLite 初始化
├── points-data.ts    # 点位数据聚合导出
└── server.ts         # 本地开发服务器入口

src/                  # 前端 React 应用
├── components/       # 组件（UploadDropzone / UploadQueue 为图片与视频面板共用）
├── lib/              # API 客户端、上传与图片校验工具、队列汇总派生逻辑
├── pages/            # 页面（UploadPage / AdminPage）
└── types.ts          # 类型定义

tests/                # 测试用例（Vitest）
├── api/              # 接口测试
├── unit/             # 纯函数单元测试
└── ui-smoke.mjs      # 上传页 UI 冒烟（CDP 驱动 headless Chrome，手动执行）
```

## CI/CD

GitHub Actions 配置在 `.github/workflows/ci.yml`，每次提交自动执行：

- 类型检查（tsc --noEmit）
- ESLint 检查
- 单元 + 接口测试
