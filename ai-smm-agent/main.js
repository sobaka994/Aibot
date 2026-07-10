const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');
const store = new Store();

let mainWindow;

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers for Settings
ipcMain.handle('get-settings', () => {
  return store.store;
});

ipcMain.handle('save-settings', (event, key, value) => {
  store.set(key, value);
  return true;
});

// Auth Browser for Instagram / VK
ipcMain.handle('open-auth-browser', async (event, platform) => {
  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    let url = '';
    if (platform === 'instagram') {
      url = 'https://www.instagram.com/';
    } else if (platform === 'vk') {
      url = 'https://vk.com/';
    }

    authWin.loadURL(url);

    // Provide a way for the user to confirm they are logged in.
    // In a real scenario, we might listen to redirects or inject scripts to detect login.
    // For simplicity, we wait for the window to close.
    authWin.on('closed', async () => {
      // You can extract cookies here
      const session = authWin.webContents.session;
      const cookies = await session.cookies.get({ url });
      store.set(`${platform}-cookies`, cookies);
      resolve({ success: true, cookies });
    });
  });
});
