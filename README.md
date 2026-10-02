# 福州沿海码头避风点点位素材上传管理系统

福州沿海 141 个码头避风点点位的现场素材归集工具。

## 功能

- **作业上传页（/）**：无密码公开访问，选择点位后上传图片/视频，页面底部展示该点位已上传素材清单
- **管理后台（/admin）**：密码校验进入，查看/下载/删除素材
  - 批量下载：按素材类型打包下载（支持选中点位或全部点位）
  - 统计表格导出：一键导出 CSV 统计表（含名称、区县、乡镇、船管站、经纬度、图片数/视频数、上传状态等）
- 图片支持 JPG / PNG / WEBP，**不限制上传数量与像素比例**；超过 300KB 的图片由前端自动压缩到 300KB 以内（优先保留分辨率），并保留 EXIF
- 图片纯黑像素占比 ≤ 10%（前端 Canvas 采样校验，防止全黑/损坏图）
- 图片上传成功后若无 EXIF GPS 经纬度，弹窗提示用户尽量上传相机/手机原图（勿经微信/QQ 转发）
- 视频仅 MP4、时长 ≥ 10 秒，**不限制上传数量**，单文件上限 100MB（可通过环境变量 VIDEO_MAX_SIZE_MB 配置），分片上传
- SQLite 嵌入式数据库，Docker 一键部署

## 技术栈

| 层       | 技术                                         |
| -------- | -------------------------------------------- |
| 前端     | React 18 + Tailwind CSS 3 + Vite 6 + zustand |
| 后端     | Node.js 22 + Express 4 + better-sqlite3      |
| 数据库   | SQLite（WAL 模式）                           |
| 鉴权     | JWT（管理后台）                              |
| 文件上传 | multer（memoryStorage） + 分片上传           |
| 部署     | Docker + docker-compose                      |

## 本地开发

> 需要 **Node.js 22**（better-sqlite3 11.x 无法在 Node 26+ 下编译，CI 与 Docker 同样锁定 22）。

```bash
pnpm install
pnpm dev
```

前端 <http://localhost:5173/> ，后端 <http://localhost:3001/>

## 测试

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

## Docker 部署

```bash
# 1. 修改 .env 中的管理员密码（默认 123456）
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

## 配置说明（.env）

| 变量              | 说明                        | 默认值                   |
| ----------------- | --------------------------- | ------------------------ |
| PORT              | 后端服务端口（容器内）      | 3001                     |
| DOCKER_PORT       | Docker 对外端口             | 15000                    |
| ADMIN_PASSWORD    | 管理员密码                  | 123456                   |
| JWT_SECRET        | JWT 密钥                    | uploader-secret-key-2024 |
| CHUNK_SIZE        | 分片大小（MB）              | 5                        |
| VIDEO_MAX_SIZE_MB | 视频单文件大小上限（MB）    | 100                      |
| DATA_DIR          | 数据存储目录（Docker 挂载） | /app/data                |

## 数据目录

```
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
数据固化在 [api/points-data.ts](api/points-data.ts)，服务启动时自动导入数据库。
其中序号 058「石壁三级渔港」原表乡镇/船管站字段为空，界面显示为「—」，待主管部门补充。

## 项目结构

```
api/                  # 后端 Express 应用
├── middleware/       # 鉴权中间件
├── routes/           # API 路由（points/upload/admin）
├── utils/            # 时间、图片尺寸、视频时长工具
├── app.ts            # 应用入口
├── db.ts             # SQLite 初始化
└── server.ts         # 本地开发服务器入口

src/                  # 前端 React 应用
├── components/       # 组件
├── lib/              # API 客户端、上传与图片校验工具
├── pages/            # 页面（UploadPage / AdminPage）
└── types.ts          # 类型定义

tests/                # 测试用例（Vitest）
```

## CI/CD

GitHub Actions 配置在 `.github/workflows/ci.yml`，每次提交自动执行：

- 类型检查（tsc --noEmit）
- ESLint 检查
- 单元 + 接口测试
