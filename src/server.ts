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

// 数据库连接
let db: any = null;

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
            )
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

        // 简单的词频分析（示例）
        const words = analyzeWords(allContent);
        const phrases = analyzePhrases(allContent);

        res.json({ words, phrases });
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

// 使用路由器
server.use('/api', router);

// 简单的词频分析函数
function analyzeWords(text: string): Array<{ text: string, frequency: number }> {
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 1);  // 过滤掉单字符的词

    const frequency: { [key: string]: number } = {};
    words.forEach(word => {
        frequency[word] = (frequency[word] || 0) + 1;
    });

    return Object.entries(frequency)
        .map(([text, frequency]) => ({ text, frequency }))
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 20);  // 只返回前20个高频词
}

// 简单的短语分析函数
function analyzePhrases(text: string): Array<{ text: string, frequency: number }> {
    const phrases = text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/[.!?]+/)
        .flatMap(sentence => {
            const words = sentence.trim().split(/\s+/);
            const result = [];
            for (let i = 0; i < words.length - 2; i++) {
                result.push(words.slice(i, i + 3).join(' '));
            }
            return result;
        });

    const frequency: { [key: string]: number } = {};
    phrases.forEach(phrase => {
        frequency[phrase] = (frequency[phrase] || 0) + 1;
    });

    return Object.entries(frequency)
        .map(([text, frequency]) => ({ text, frequency }))
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 10);  // 只返回前10个高频短语
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