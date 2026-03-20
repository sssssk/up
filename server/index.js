const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const { v4: uuidv4 } = require('uuid');
const { recognizeImage, extractPaperInfo } = require('./ocr');

const app = express();
const PORT = 3003;

// 管理员账号配置
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// 会话存储（生产环境应使用Redis等）
const sessions = new Map();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 登录页面路由
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
    return res.status(401).json({ success: false, error: '登录已过期，请重新登录' });
  }
  
  req.user = session;
  next();
}

// API: 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
      username,
      expires: Date.now() + 24 * 60 * 60 * 1000 // 24小时过期
    });
    
    res.json({ success: true, token, message: '登录成功' });
  } else {
    res.status(401).json({ success: false, error: '用户名或密码错误' });
  }
});

// API: 登出
app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && sessions.has(token)) {
    sessions.delete(token);
  }
  res.json({ success: true });
});

// API: 检查登录状态
app.get('/api/check-auth', requireAuth, (req, res) => {
  res.json({ success: true, user: { username: req.user.username } });
});

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'));
    }
  }
});

// 存储识别结果
const recognitionResults = new Map();

// 以下API都需要登录
// API: 上传文件
app.post('/api/upload', requireAuth, upload.array('files', 20), async (req, res) => {
  try {
    const files = req.files;
    const results = [];

    for (const file of files) {
      const fileId = uuidv4();
      const fileInfo = {
        id: fileId,
        filename: file.originalname,
        path: file.path,
        size: file.size,
        mimetype: file.mimetype,
        status: 'pending',
        recognizedText: '',
        extractedInfo: null,
        error: null
      };
      recognitionResults.set(fileId, fileInfo);
      results.push(fileInfo);
    }

    res.json({ success: true, files: results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: OCR识别单个文件
app.post('/api/recognize/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const fileInfo = recognitionResults.get(id);

    if (!fileInfo) {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }

    fileInfo.status = 'processing';

    const ocrResult = await recognizeImage(fileInfo.path);
    fileInfo.recognizedText = ocrResult.text;

    const extractedInfo = await extractPaperInfo(ocrResult.text);
    fileInfo.extractedInfo = extractedInfo;
    fileInfo.status = 'done';

    res.json({ success: true, file: fileInfo });
  } catch (error) {
    const fileInfo = recognitionResults.get(req.params.id);
    if (fileInfo) {
      fileInfo.status = 'error';
      fileInfo.error = error.message;
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 批量识别
app.post('/api/recognize-all', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    const results = [];

    for (const id of ids) {
      const fileInfo = recognitionResults.get(id);
      if (!fileInfo) continue;

      try {
        fileInfo.status = 'processing';

        const ocrResult = await recognizeImage(fileInfo.path);
        fileInfo.recognizedText = ocrResult.text;

        const extractedInfo = await extractPaperInfo(ocrResult.text);
        fileInfo.extractedInfo = extractedInfo;
        fileInfo.status = 'done';

        results.push({ id, success: true, file: fileInfo });
      } catch (error) {
        fileInfo.status = 'error';
        fileInfo.error = error.message;
        results.push({ id, success: false, error: error.message });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 获取文件列表
app.get('/api/files', requireAuth, (req, res) => {
  const files = Array.from(recognitionResults.values());
  res.json({ success: true, files });
});

// API: 更新提取信息
app.put('/api/files/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const fileInfo = recognitionResults.get(id);

  if (!fileInfo) {
    return res.status(404).json({ success: false, error: '文件不存在' });
  }

  fileInfo.extractedInfo = { ...fileInfo.extractedInfo, ...req.body };
  res.json({ success: true, file: fileInfo });
});

// API: 删除文件
app.delete('/api/files/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const fileInfo = recognitionResults.get(id);

  if (!fileInfo) {
    return res.status(404).json({ success: false, error: '文件不存在' });
  }

  if (fs.existsSync(fileInfo.path)) {
    fs.unlinkSync(fileInfo.path);
  }

  recognitionResults.delete(id);
  res.json({ success: true });
});

// API: 提交到试卷库
app.post('/api/submit', requireAuth, async (req, res) => {
  try {
    const { files } = req.body;
    res.json({ success: true, message: '提交成功', count: files.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 获取筛选选项
app.get('/api/options', requireAuth, async (req, res) => {
  try {
    const response = await fetch('http://localhost:3002/api/grades');
    const grades = await response.json();

    const subjectsRes = await fetch('http://localhost:3002/api/subjects');
    const subjects = await subjectsRes.json();

    const typesRes = await fetch('http://localhost:3002/api/types');
    const types = await typesRes.json();

    const regionsRes = await fetch('http://localhost:3002/api/regions');
    const regions = await regionsRes.json();

    res.json({
      success: true,
      options: {
        grades: grades.data || [],
        subjects: subjects.data || [],
        types: types.data || [],
        regions: regions.data || []
      }
    });
  } catch (error) {
    res.json({
      success: true,
      options: {
        grades: ['初一', '初二', '初三', '高一', '高二', '高三'],
        subjects: ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'],
        types: ['月考', '期中', '期末', '单元测试', '模拟考试'],
        regions: ['长沙', '株洲', '湘潭', '衡阳', '邵阳', '岳阳', '常德', '张家界']
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`资料上传系统运行在 http://localhost:${PORT}`);
});
