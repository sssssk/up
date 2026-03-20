# 📦 资料上传系统

OCR识别 + AI提取 + 批量上传

## 功能特性

- ✅ 批量上传试卷图片/PDF（最多20个）
- ✅ 腾讯云OCR自动识别文字
- ✅ AI智能提取：年级/科目/类型/地区/学校/考试名称
- ✅ 表格批量预览+编辑
- ✅ 一键提交到试卷库

## 技术栈

- 后端: Express.js
- OCR: 腾讯云OCR API
- 前端: 原生HTML + Tailwind CSS

## 快速开始

```bash
# 安装依赖
cd /var/www/up
npm install

# 启动服务
npm start

# 访问
http://159.75.5.234:3003/
```

## 文件命名规则

格式: `年级代码-学年起-学年止-学期代码 学校简称+考试名称`

示例:
- `7-2025-2026-1 青一七上第三次月考`
- `8-2025-2026-2 长郡八下期中`

## API端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/upload` | POST | 上传文件 |
| `/api/recognize/:id` | POST | OCR识别单个文件 |
| `/api/recognize-all` | POST | 批量识别 |
| `/api/files` | GET | 获取文件列表 |
| `/api/files/:id` | PUT | 更新提取信息 |
| `/api/files/:id` | DELETE | 删除文件 |
| `/api/submit` | POST | 提交到试卷库 |
| `/api/options` | GET | 获取筛选选项 |

## 部署

使用 PM2 管理:

```bash
pm2 start /var/www/up/server/index.js --name up
pm2 save
```

Nginx 配置:

```nginx
location /up/ {
    proxy_pass http://localhost:3003/;
}
```
