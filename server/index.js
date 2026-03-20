const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config(); // 加载.env文件
const { recognizeImage, extractPaperInfo } = require('./ocr');

const app = express();
const PORT = 3003;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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

// API: 上传文件
app.post('/api/upload', upload.array('files', 20), async (req, res) => {
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
        status: 'pending', // pending, processing, done, error
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
app.post('/api/recognize/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const fileInfo = recognitionResults.get(id);

    if (!fileInfo) {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }

    fileInfo.status = 'processing';

    // OCR识别
    const ocrResult = await recognizeImage(fileInfo.path);
    fileInfo.recognizedText = ocrResult.text;

    // AI提取信息
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
app.post('/api/recognize-all', async (req, res) => {
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
app.get('/api/files', (req, res) => {
  const files = Array.from(recognitionResults.values());
  res.json({ success: true, files });
});

// API: 更新提取信息
app.put('/api/files/:id', (req, res) => {
  const { id } = req.params;
  const fileInfo = recognitionResults.get(id);

  if (!fileInfo) {
    return res.status(404).json({ success: false, error: '文件不存在' });
  }

  fileInfo.extractedInfo = { ...fileInfo.extractedInfo, ...req.body };
  res.json({ success: true, file: fileInfo });
});

// API: 删除文件
app.delete('/api/files/:id', (req, res) => {
  const { id } = req.params;
  const fileInfo = recognitionResults.get(id);

  if (!fileInfo) {
    return res.status(404).json({ success: false, error: '文件不存在' });
  }

  // 删除物理文件
  if (fs.existsSync(fileInfo.path)) {
    fs.unlinkSync(fileInfo.path);
  }

  recognitionResults.delete(id);
  res.json({ success: true });
});

// API: 提交到试卷库
app.post('/api/submit', async (req, res) => {
  try {
    const { files } = req.body; // 文件ID数组

    // TODO: 调用试卷库API上传
    // 这里需要连接到 /var/www/exampapers/backend/ 的试卷库系统

    res.json({ success: true, message: '提交成功', count: files.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 获取筛选选项（与试卷库同步）
app.get('/api/options', async (req, res) => {
  try {
    // 从试卷库获取筛选选项
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
    // 返回默认选项
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
