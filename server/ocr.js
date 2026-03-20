const tencentcloud = require("tencentcloud-sdk-nodejs-ocr");

const OcrClient = tencentcloud.ocr.v20181119.Client;

// 腾讯云凭证 - 从环境变量读取
const clientConfig = {
  credential: {
    secretId: process.env.TENCENTCLOUD_SECRET_ID,
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
  },
  region: "ap-guangzhou",
  profile: {
    httpProfile: {
      endpoint: "ocr.tencentcloudapi.com",
    },
  },
};

const client = new OcrClient(clientConfig);

/**
 * OCR识别图片
 * @param {string} imagePath - 图片路径
 * @returns {Promise<{text: string, confidence: number}>}
 */
async function recognizeImage(imagePath) {
  const fs = require('fs');
  const imageBase64 = fs.readFileSync(imagePath).toString('base64');

  const params = {
    ImageBase64: imageBase64,
  };

  try {
    // 使用通用文字识别（高精度版）
    const response = await client.GeneralAccurateOCR(params);

    // 合并所有文字块
    const text = response.TextDetections
      .map(item => item.DetectedText)
      .join('\n');

    // 计算平均置信度
    const avgConfidence = response.TextDetections.reduce((sum, item) => {
      return sum + (item.Confidence || 0);
    }, 0) / response.TextDetections.length;

    return {
      text,
      confidence: avgConfidence,
      rawResult: response.TextDetections
    };
  } catch (error) {
    console.error('OCR识别失败:', error);
    throw new Error('OCR识别失败: ' + error.message);
  }
}

/**
 * 从OCR文本中提取试卷信息
 * @param {string} text - OCR识别的文本
 * @returns {Promise<Object>}
 */
async function extractPaperInfo(text) {
  // 定义关键词规则
  const info = {
    grade: null,        // 年级
    subject: null,      // 科目
    type: null,         // 类型（月考/期中/期末等）
    region: null,       // 地区
    school: null,       // 学校
    academicYear: null, // 学年
    semester: null,     // 学期（上/下）
    title: null,        // 考试名称
    generatedName: null // 生成的文件名
  };

  // 年级识别规则
  const gradePatterns = [
    { pattern: /七年级|初一|七上|七下/g, value: '初一', code: 7 },
    { pattern: /八年级|初二|八上|八下/g, value: '初二', code: 8 },
    { pattern: /九年级|初三|九上|九下/g, value: '初三', code: 9 },
    { pattern: /高一|高一上|高一下/g, value: '高一', code: 10 },
    { pattern: /高二|高二上|高二下/g, value: '高二', code: 11 },
    { pattern: /高三|高三上|高三下/g, value: '高三', code: 12 },
  ];

  for (const { pattern, value, code } of gradePatterns) {
    if (pattern.test(text)) {
      info.grade = value;
      info.gradeCode = code;
      break;
    }
  }

  // 科目识别
  const subjectPatterns = [
    { pattern: /语文/g, value: '语文' },
    { pattern: /数学/g, value: '数学' },
    { pattern: /英语|English/gi, value: '英语' },
    { pattern: /物理/g, value: '物理' },
    { pattern: /化学/g, value: '化学' },
    { pattern: /生物/g, value: '生物' },
    { pattern: /政治|道德与法治/g, value: '政治' },
    { pattern: /历史/g, value: '历史' },
    { pattern: /地理/g, value: '地理' },
  ];

  for (const { pattern, value } of subjectPatterns) {
    if (pattern.test(text)) {
      info.subject = value;
      break;
    }
  }

  // 考试类型识别
  const typePatterns = [
    { pattern: /月考|月测试/g, value: '月考' },
    { pattern: /期中/g, value: '期中' },
    { pattern: /期末/g, value: '期末' },
    { pattern: /单元测试|单元|测验/g, value: '单元测试' },
    { pattern: /模拟|仿真/g, value: '模拟考试' },
    { pattern: /入学考试|入学/g, value: '入学考试' },
  ];

  for (const { pattern, value } of typePatterns) {
    if (pattern.test(text)) {
      info.type = value;
      break;
    }
  }

  // 学校识别
  const schoolPatterns = [
    { pattern: /青竹湖湘一|青一/g, value: '青竹湖湘一', short: '青一' },
    { pattern: /长郡|长郡中学/g, value: '长郡中学', short: '长郡' },
    { pattern: /雅礼|雅礼中学/g, value: '雅礼中学', short: '雅礼' },
    { pattern: /师大附中|湖南师大附中/g, value: '湖南师大附中', short: '师大附中' },
    { pattern: /一中|长沙市一中/g, value: '长沙市一中', short: '一中' },
    { pattern: /周南/g, value: '周南中学', short: '周南' },
    { pattern: /明德/g, value: '明德中学', short: '明德' },
  ];

  for (const { pattern, value, short } of schoolPatterns) {
    if (pattern.test(text)) {
      info.school = value;
      info.schoolShort = short;
      break;
    }
  }

  // 学年识别
  const yearPattern = /(\d{4})[-—–](\d{4})学年第?([一二]|\d)?学期?/;
  const yearMatch = text.match(yearPattern);
  if (yearMatch) {
    info.academicYear = `${yearMatch[1]}-${yearMatch[2]}`;
    const semesterNum = yearMatch[3];
    if (semesterNum === '一' || semesterNum === '1') {
      info.semester = '上学期';
      info.semesterCode = 1;
    } else if (semesterNum === '二' || semesterNum === '2') {
      info.semester = '下学期';
      info.semesterCode = 2;
    }
  }

  // 学期识别（补充）
  if (!info.semester) {
    if (/上学期|第一学期|上册/.test(text)) {
      info.semester = '上学期';
      info.semesterCode = 1;
    } else if (/下学期|第二学期|下册/.test(text)) {
      info.semester = '下学期';
      info.semesterCode = 2;
    }
  }

  // 当前学年（默认）
  if (!info.academicYear) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 9) {
      info.academicYear = `${year}-${year + 1}`;
    } else {
      info.academicYear = `${year - 1}-${year}`;
    }
  }

  // 生成文件名
  info.generatedName = generateFileName(info);

  return info;
}

/**
 * 生成标准文件名
 * 格式: 年级代码-学年起-学年止-学期代码 学校简称+考试名称
 * 示例: 7-2025-2026-1 青一七上第三次月考
 */
function generateFileName(info) {
  const parts = [];

  // 年级代码
  if (info.gradeCode) {
    parts.push(info.gradeCode);
  }

  // 学年
  if (info.academicYear) {
    const [start, end] = info.academicYear.split('-');
    parts.push(start);
    parts.push(end);
  }

  // 学期代码
  if (info.semesterCode) {
    parts.push(info.semesterCode);
  }

  // 学校简称
  if (info.schoolShort) {
    parts.push(info.schoolShort);
  }

  // 考试名称组合
  const titleParts = [];
  if (info.grade) {
    const shortGrade = info.grade.replace('初', '');
    titleParts.push(shortGrade + (info.semesterCode === 1 ? '上' : '下'));
  }
  if (info.type) {
    titleParts.push(info.type);
  }

  if (titleParts.length > 0) {
    parts.push(titleParts.join(''));
  }

  return parts.join(' ');
}

module.exports = {
  recognizeImage,
  extractPaperInfo,
  generateFileName
};
