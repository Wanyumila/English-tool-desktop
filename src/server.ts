import express, { Request, Response, Router } from 'express';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { app } from 'electron';

interface Collection {
    date: string;
    contents: string;
}

interface CollectionRow {
    content: string;
}

interface ApiError extends Error {
    status?: number;
}

interface LearnedItem {
    text: string;
}

// 数据库连接
let db: any = null;

// 预定义的基础单词列表
const basicWords = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
    'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
    'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than',
    'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back',
    'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even',
    'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'is', 'are',
    'was', 'were', 'been', 'being', 'am', 'has', 'had', 'having', 'do', 'does', 'did',
    'doing', 'should', 'would', 'could', 'might', 'must', 'shall', 'will', 'may',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
    'this', 'that', 'these', 'those', 'here', 'there', 'where', 'when', 'why', 'how',
    'which', 'who', 'whom', 'whose', 'what', 'whatever', 'whoever', 'whichever',
    'and', 'or', 'but', 'nor', 'yet', 'so', 'for', 'else', 'if', 'then', 'thus',
    'while', 'where', 'when', 'because', 'therefore', 'hence', 'consequently',
    'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'about', 'into', 'through',
    'after', 'before', 'during', 'under', 'over', 'between', 'among', 'above', 'below'
]);

// 初始化数据库
async function initializeDatabase() {
    try {
        const dbPath = path.join(app.getPath('userData'), 'collections.db');
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        // 创建表
        await db.exec(`
            CREATE TABLE IF NOT EXISTS collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS learned_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL UNIQUE,
                learned_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
    } catch (error) {
        console.error('Failed to initialize database:', error);
        throw error;
    }
}

// 创建 Express 应用和路由器
const server = express();
const router = Router();

// 配置中间件
server.use(express.json());
server.use(express.static(path.join(__dirname, '../public')));

// 错误处理中间件
const errorHandler = (err: ApiError, req: Request, res: Response) => {
    console.error('API Error:', err);
    const status = err.status || 500;
    const message = err.message || 'Internal server error';
    res.status(status).json({ error: message });
};

// 路由处理函数
const getCollections = async (req: Request, res: Response): Promise<void> => {
    try {
        const collections: Collection[] = await db.all(`
            SELECT 
                date(created_at) as date,
                GROUP_CONCAT(content, '|||') as contents
            FROM collections 
            GROUP BY date(created_at)
            ORDER BY date DESC
        `);

        // 处理结果为前端需要的格式
        const result: { [key: string]: string[] } = {};
        collections.forEach(row => {
            result[row.date] = row.contents.split('|||');
        });

        res.json(result);
    } catch (error) {
        const apiError = error as ApiError;
        apiError.status = 500;
        errorHandler(apiError, req, res);
    }
};

const saveCollection = async (req: Request, res: Response): Promise<void> => {
    try {
        const { content } = req.body;
        if (!content) {
            const error = new Error('Content is required') as ApiError;
            error.status = 400;
            throw error;
        }

        await db.run('INSERT INTO collections (content) VALUES (?)', content);
        res.json({ success: true });
    } catch (error) {
        const apiError = error as ApiError;
        apiError.status = apiError.status || 500;
        errorHandler(apiError, req, res);
    }
};

const analyzeContent = async (req: Request, res: Response): Promise<void> => {
    try {
        const { date } = req.params;
        const collections: CollectionRow[] = await db.all(
            'SELECT content FROM collections WHERE date(created_at) = ?',
            date
        );

        if (collections.length === 0) {
            const error = new Error('No content found for the specified date') as ApiError;
            error.status = 404;
            throw error;
        }

        // 合并所有内容
        const allContent = collections.map(row => row.content).join(' ');

        // 分析词频和短语
        const [words, phrases] = await Promise.all([
            analyzeWords(allContent),
            analyzePhrases(allContent)
        ]);

        res.json({ words, phrases });
    } catch (error) {
        const apiError = error as ApiError;
        apiError.status = apiError.status || 500;
        errorHandler(apiError, req, res);
    }
};

const getLearnedItems = async (req: Request, res: Response): Promise<void> => {
    try {
        const items: LearnedItem[] = await db.all('SELECT text FROM learned_items ORDER BY learned_at DESC');
        res.json(items.map(item => item.text));
    } catch (error) {
        const apiError = error as ApiError;
        apiError.status = 500;
        errorHandler(apiError, req, res);
    }
};

const markAsLearned = async (req: Request, res: Response): Promise<void> => {
    try {
        const { text } = req.body;
        if (!text) {
            const error = new Error('Text is required') as ApiError;
            error.status = 400;
            throw error;
        }

        await db.run('INSERT OR IGNORE INTO learned_items (text) VALUES (?)', text);
        res.json({ success: true });
    } catch (error) {
        const apiError = error as ApiError;
        apiError.status = apiError.status || 500;
        errorHandler(apiError, req, res);
    }
};

// 配置路由
router.get('/collections', getCollections);
router.post('/collections', saveCollection);
router.get('/analyze/:date', analyzeContent);
router.get('/learned', getLearnedItems);
router.post('/learned', markAsLearned);

// 使用路由器
server.use('/api', router);

// 检查短语是否有效
function isValidPhrase(phrase: string): boolean {
    // 1. 检查是否包含数字或特殊字符
    if (/[0-9@#$%^&*()_+=\[\]{}|\\<>?]/.test(phrase)) {
        return false;
    }

    // 2. 检查每个单词是否都是有效的英文单词（至少2个字母）
    const words = phrase.split(' ');
    if (!words.every(word => word.length >= 2 && /^[a-zA-Z]+$/.test(word))) {
        return false;
    }

    // 3. 检查短语的总长度（避免过长或过短）
    if (phrase.length < 5 || phrase.length > 50) {
        return false;
    }

    return true;
}

// 修改短语分析函数
async function analyzePhrases(text: string): Promise<Array<{ text: string, frequency: number }>> {
    const phrases = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')  // 将标点符号替换为空格
        .replace(/\s+/g, ' ')      // 将多个空格合并为一个
        .split(/[.!?]+/)
        .flatMap(sentence => {
            const words = sentence.trim().split(/\s+/);
            const result = [];
            for (let i = 0; i < words.length - 2; i++) {
                const phrase = words.slice(i, i + 3).join(' ');
                // 只添加有效的短语，且不是全部由基础单词组成
                if (isValidPhrase(phrase) && !phrase.split(' ').every(word => basicWords.has(word))) {
                    result.push(phrase);
                }
            }
            return result;
        });

    const frequency: { [key: string]: number } = {};
    phrases.forEach(phrase => {
        frequency[phrase] = (frequency[phrase] || 0) + 1;
    });

    // 获取已学会的短语
    const learnedItems: LearnedItem[] = await db.all('SELECT text FROM learned_items');
    const learnedSet = new Set(learnedItems.map(item => item.text.toLowerCase()));

    // 过滤掉包含已学会单词的短语
    return Object.entries(frequency)
        .filter(([text]) => !text.split(' ').some(word => learnedSet.has(word)))
        .map(([text, frequency]) => ({ text, frequency }))
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 10);  // 只返回前10个高频短语
}

// 修改词频分析函数
async function analyzeWords(text: string): Promise<Array<{ text: string, frequency: number }>> {
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 1);  // 过滤掉单字符的词

    const frequency: { [key: string]: number } = {};
    words.forEach(word => {
        if (!basicWords.has(word.toLowerCase())) {  // 过滤掉基础单词
            frequency[word] = (frequency[word] || 0) + 1;
        }
    });

    // 获取已学会的单词
    const learnedItems: LearnedItem[] = await db.all('SELECT text FROM learned_items');
    const learnedSet = new Set(learnedItems.map(item => item.text.toLowerCase()));

    // 过滤掉已学会的单词
    return Object.entries(frequency)
        .filter(([text]) => !learnedSet.has(text))
        .map(([text, frequency]) => ({ text, frequency }))
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 20);  // 只返回前20个高频词
}

// 启动服务器
export async function startServer() {
    try {
        await initializeDatabase();
        
        const port = 3000;
        server.listen(port, () => {
            console.log(`Server is running on http://localhost:${port}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
} 