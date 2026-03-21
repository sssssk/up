const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const FormData = require('form-data');
const archiver = require('archiver');
require('dotenv').config();

const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3003;

// 管理员账号配置
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// 会话存储
const sessions = new Map();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 登录页面
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// 登录验证中间件
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ success: false, error: '请先登录' });
  }
  const session = sessions.get(token);
  if (Date.now() > session.expires) {
    sessions.delete(token);
    return res.status(401).json({ success: false, error: '登录已过期' });
  }
  req.user = session;
  next();
}

// API: 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { username, expires: Date.now() + 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, message: '登录成功' });
  } else {
    res.status(401).json({ success: false, error: '用户名或密码错误' });
  }
});

// API: 检查登录状态
app.get('/api/check-auth', requireAuth, (req, res) => {
  res.json({ success: true, user: { username: req.user.username } });
});

// API: 退出登录
app.post('/api/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  sessions.delete(token);
  res.json({ success: true });
});

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('不支持的文件类型'));
  }
});

// 将文件压缩成 zip（最大压缩率）
function compressToZip(filePath, originalName) {
  return new Promise((resolve, reject) => {
    const zipPath = filePath.replace(path.extname(filePath), '.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } }); // 最大压缩率
    
    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    
    archive.pipe(output);
    archive.file(filePath, { name: originalName });
    archive.finalize();
  });
}

// API: 上传文件（自动压缩成 zip）
app.post('/api/upload', requireAuth, upload.array('files', 20), async (req, res) => {
  try {
    const results = [];
    
    for (const file of req.files) {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      
      // 将文件压缩成 zip
      const zipPath = await compressToZip(file.path, originalName);
      
      // 删除原始文件，只保留 zip
      try { fs.unlinkSync(file.path); } catch(e) {}
      
      results.push({
        id: uuidv4(),
        filename: originalName,
        path: zipPath,
        size: fs.statSync(zipPath).size,
        mimetype: 'application/zip',
        newName: '',
        info: {}
      });
    }
    
    res.json({ success: true, files: results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 解析文件名获取信息
function parseFilenameInfo(newName) {
  const parts = newName.split('-');
  return {
    grade_id: parts[0] || '',
    subject_name: parts[4] || '',
    type_name: parts[6] || ''
  };
}

// 科目和类型映射
const subjectMap = { '语文': 1, '数学': 2, '英语': 3, '物理': 4, '化学': 5 };
const typeMap = { '月考': 1, '期中': 2, '期末': 3, '一模': 4, '二模': 5, '开学考试': 6, '单元测试': 7 };

// API: 提交到试卷库
app.post('/api/submit', requireAuth, async (req, res) => {
  try {
    const { files: fileList } = req.body;
    const http = require('http');
    const FormData = require('form-data');
    const fs = require('fs');
    
    let successCount = 0;
    
    for (const file of fileList) {
      // 解析文件名获取信息
      const info = parseFilenameInfo(file.newName);
      const subjectId = subjectMap[info.subject_name] || 2;
      const typeId = typeMap[info.type_name] || 1;
      
      // 创建form-data，提交 zip 文件
      const form = new FormData();
      form.append('title', file.newName);
      form.append('grade_id', info.grade_id);
      form.append('subject_id', subjectId);
      form.append('type_id', typeId);
      form.append('region_id', '长沙');
      form.append('price', 0);
      form.append('price_type', 'free');
      form.append('page_count', 1);
      form.append('preview_pages', 3);
      
      // 读取 zip 文件并发送
      const zipFilename = path.basename(file.path);
      form.append('file', fs.createReadStream(file.path), {
        filename: zipFilename,
        contentType: 'application/zip'
      });
      
      // 调用试卷库API
      await new Promise((resolve, reject) => {
        const request = http.request({
          hostname: 'localhost',
          port: 3005,
          path: '/api/admin/papers',
          method: 'POST',
          headers: form.getHeaders()
        }, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.success || result.id) {
                successCount++;
                // 删除临时 zip 文件
                try { fs.unlinkSync(file.path); } catch(e) {}
              }
              resolve();
            } catch(e) { resolve(); }
          });
        });
        request.on('error', reject);
        form.pipe(request);
      });
    }
    
    res.json({ success: true, count: successCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Up系统服务运行在端口 ${PORT}`);
});
