import { app, globalShortcut, clipboard, Notification, BrowserWindow } from 'electron';
import * as path from 'path';
import axios from 'axios';
import type { AxiosError } from 'axios';
import { startServer } from './server';

interface ApiResponse {
  success: boolean;
  error?: string;
}

let mainWindow: BrowserWindow | null = null;

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // 允许加载本地资源
    },
    show: false // 先不显示窗口
  });

  // 等待服务器启动后再加载页面
  const loadPage = async () => {
    try {
      await axios.get('http://localhost:3000');
      mainWindow?.loadURL('http://localhost:3000');
      mainWindow?.show(); // 加载完成后显示窗口
    } catch (error) {
      console.log('Waiting for server to start...');
      setTimeout(loadPage, 1000); // 每秒重试一次
    }
  };

  loadPage();
  
  // 打开开发者工具
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 启动 Web 服务器和应用程序
async function startApp() {
  try {
    await startServer();
    if (app.isReady()) {
      createWindow();
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    app.quit();
  }
}

// 启动应用
startApp();

async function sendToWebApp(text: string): Promise<void> {
  try {
    const response = await axios.post<ApiResponse>('http://localhost:3000/api/collections', {
      content: text
    });
    
    if (response.data.success) {
      showNotification('内容已收集', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
      // 刷新主窗口内容
      mainWindow?.webContents.reload();
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error sending text to web app:', error.message);
      const axiosError = error as AxiosError<ApiResponse>;
      if (axiosError.response?.data?.error) {
        showNotification('保存失败', axiosError.response.data.error);
      } else {
        showNotification('保存失败', '无法保存内容');
      }
    } else {
      console.error('Error sending text to web app:', error);
      showNotification('保存失败', '无法保存内容');
    }
  }
}

function showNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      silent: false,
      timeoutType: 'default'
    });
    notification.show();
  }
}

function registerShortcuts(): void {
  // 先注销所有快捷键，确保没有残留的注册
  globalShortcut.unregisterAll();
  
  // 使用 Alt+C (macOS 上是 Option+C)
  const shortcutKey = process.platform === 'darwin' ? 'Alt+C' : 'Alt+C';
  const registered = globalShortcut.register(shortcutKey, () => {
    const text = clipboard.readText();
    if (text) {
      sendToWebApp(text);
    }
  });

  if (!registered) {
    console.error('Failed to register shortcut:', shortcutKey);
  }
}

app.whenReady().then(() => {
  registerShortcuts();
  createWindow();
  
  showNotification(
    '英语学习工具已启动',
    '选中并复制文本后，按下 ' + (process.platform === 'darwin' ? 'Option + C' : 'Alt + C') + ' 即可保存内容'
  );
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
}); 