// 後台邏輯 admin.js

document.addEventListener('DOMContentLoaded', () => {
  // DOM 元素選取
  const authPanel = document.getElementById('authPanel');
  const adminPanel = document.getElementById('adminPanel');
  const authForm = document.getElementById('authForm');
  const githubToken = document.getElementById('githubToken');
  const repoOwner = document.getElementById('repoOwner');
  const repoName = document.getElementById('repoName');
  const repoBranch = document.getElementById('repoBranch');
  const filePath = document.getElementById('filePath');
  const btnConnect = document.getElementById('btnConnect');
  const connectionStatus = document.getElementById('connectionStatus');
  const btnLogout = document.getElementById('btnLogout');
  
  const gamesFormsContainer = document.getElementById('gamesFormsContainer');
  const statRegistered = document.getElementById('statRegistered');
  const statNew = document.getElementById('statNew');
  const statTotal = document.getElementById('statTotal');
  const quickNavLinks = document.getElementById('quickNavLinks');
  const toast = document.getElementById('toastNotification');

  // 後台狀態變數
  let token = '';
  let config = { owner: '', repo: '', branch: '', path: '' };
  
  let gamesList = [];      // 來自 games.json 的已登記遊戲列表
  let foldersList = [];    // 來自 games/ 目錄下的子資料夾名稱列表
  let activeList = [];     // 比對合併後的總展示清單 (包含已登錄與新偵測到)
  let fileSha = '';        // games.json 在 GitHub 上的 SHA (更新檔案必填)
  let isDemoMode = false;  // 是否為本地 Demo 測試模式
  let detectedHtmlFiles = {}; // 存放已偵測到的新遊戲 HTML 檔名，格式為 { folderName: htmlFileName }
  let detectedCoverFiles = {}; // 存放已偵測到的新遊戲封面圖片檔名，格式為 { folderName: coverFileName }

  // 顯示 Toast 反饋
  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // UTF-8 安全的 Base64 解碼 (防止中文亂碼)
  function decodeBase64Utf8(str) {
    return decodeURIComponent(
      atob(str)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  }

  // UTF-8 安全的 Base64 編碼 (防止中文亂碼)
  function encodeBase64Utf8(str) {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode(parseInt(p1, 16));
      })
    );
  }

  // 1. 初始化：載入本地快取的憑證
  function loadSavedCredentials() {
    const savedToken = localStorage.getItem('pico8_github_token');
    const savedConfig = localStorage.getItem('pico8_github_config');
    
    if (savedToken && savedConfig) {
      token = savedToken;
      try {
        config = JSON.parse(savedConfig);
        
        // 填入表單欄位
        githubToken.value = token;
        repoOwner.value = config.owner;
        repoName.value = config.repo;
        repoBranch.value = config.branch || 'main';
        filePath.value = config.path || 'games.json';
        
        // 自動連線
        connectToGithub();
      } catch (e) {
        console.error('解析快取憑證錯誤:', e);
        localStorage.removeItem('pico8_github_token');
        localStorage.removeItem('pico8_github_config');
      }
    }
  }

  // 2. 登入連線：呼叫 GitHub API 獲取 games.json 與 games/ 目錄
  async function connectToGithub() {
    // 若不是自動載入，則讀取輸入欄位
    if (!token) {
      token = githubToken.value.trim();
      config = {
        owner: repoOwner.value.trim(),
        repo: repoName.value.trim(),
        branch: repoBranch.value.trim(),
        path: filePath.value.trim()
      };
    }

    if (!token || !config.owner || !config.repo) {
      showToast('請完整填寫 GitHub 認證欄位', true);
      return;
    }

    btnConnect.disabled = true;
    btnConnect.textContent = '連線驗證中...';
    isDemoMode = false;

    try {
      // (A) 獲取 games.json
      const jsonUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.path}?ref=${config.branch}`;
      const jsonResponse = await fetch(jsonUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!jsonResponse.ok) {
        if (jsonResponse.status === 401) {
          throw new Error('GitHub Token 驗證失敗 (401)，請檢查權杖是否正確。');
        } else if (jsonResponse.status === 404) {
          throw new Error(`找不到設定檔 ${config.path} (404)，請確認路徑或分支。`);
        } else {
          throw new Error(`連線失敗，狀態碼: ${jsonResponse.status}`);
        }
      }

      const jsonData = await jsonResponse.json();
      fileSha = jsonData.sha;
      const decodedContent = decodeBase64Utf8(jsonData.content.replace(/\s/g, ''));
      gamesList = JSON.parse(decodedContent);

      // (B) 獲取 games/ 資料夾列表
      const dirUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/games?ref=${config.branch}`;
      const dirResponse = await fetch(dirUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      foldersList = [];
      if (dirResponse.ok) {
        const dirData = await dirResponse.json();
        if (Array.isArray(dirData)) {
          // 只保留目錄類型 (type: "dir")
          foldersList = dirData
            .filter(item => item.type === 'dir')
            .map(item => item.name);
        }
      } else {
        console.warn('無法讀取 games/ 資料夾列表，可能目錄尚未建立。我們將以空列表進行比對。');
      }

      // (C) 針對未登記的新資料夾，自動發送請求搜尋其中的 HTML 檔案名稱
      const newFolders = foldersList.filter(folderName => !gamesList.some(game => game.id === folderName));
      if (newFolders.length > 0) {
        const detectPromises = newFolders.map(async (folderName) => {
          try {
            const filesUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/games/${folderName}?ref=${config.branch}`;
            const filesResponse = await fetch(filesUrl, {
              headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
              }
            });
            if (filesResponse.ok) {
              const files = await filesResponse.json();
              if (Array.isArray(files)) {
                // 優先使用 index.html
                const indexHtml = files.find(f => f.name.toLowerCase() === 'index.html' && f.type === 'file');
                if (indexHtml) {
                  detectedHtmlFiles[folderName] = 'index.html';
                } else {
                  // 否則使用任意找到的第一個 .html 檔案
                  const anyHtml = files.find(f => f.name.toLowerCase().endsWith('.html') && f.type === 'file');
                  if (anyHtml) {
                    detectedHtmlFiles[folderName] = anyHtml.name;
                  } else {
                    detectedHtmlFiles[folderName] = 'index.html';
                  }
                }

                // --- 偵測圖片檔案 (封面圖/Label) ---
                const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif'];
                const imageFiles = files.filter(f => f.type === 'file' && imageExtensions.some(ext => f.name.toLowerCase().endsWith(ext)));
                if (imageFiles.length > 0) {
                  const coverFile = imageFiles.find(f => f.name.toLowerCase().startsWith('cover.'));
                  if (coverFile) {
                    detectedCoverFiles[folderName] = coverFile.name;
                  } else {
                    const labelFile = imageFiles.find(f => f.name.toLowerCase().includes('label'));
                    if (labelFile) {
                      detectedCoverFiles[folderName] = labelFile.name;
                    } else {
                      const cartFile = imageFiles.find(f => f.name.toLowerCase().endsWith('.p8.png'));
                      if (cartFile) {
                        detectedCoverFiles[folderName] = cartFile.name;
                      } else {
                        detectedCoverFiles[folderName] = imageFiles[0].name;
                      }
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.error(`自動偵測資料夾 ${folderName} 內容失敗:`, e);
          }
        });
        await Promise.allSettled(detectPromises);
      }

      // 儲存資訊至 localStorage
      localStorage.setItem('pico8_github_token', token);
      localStorage.setItem('pico8_github_config', JSON.stringify(config));

      // 更新連接狀態顯示
      connectionStatus.textContent = `${config.owner}/${config.repo} (${config.branch})`;
      
      // 比對並渲染
      compareAndBuildList();

      // 切換顯示面板
      authPanel.style.display = 'none';
      adminPanel.style.display = 'block';
      showToast('連線驗證成功，資料已同步！');

    } catch (error) {
      console.error(error);
      showToast(error.message, true);
      
      // 離線/驗證失敗時的 Demo 測試模式
      const enterDemo = confirm(`${error.message}\n\n是否要改為啟動「本地展示/Demo測試模式」？\n此模式將會模擬 games/ 底下的子資料夾以展示自動比對與表單渲染功能（無法提交至 GitHub）。`);
      if (enterDemo) {
        startDemoMode();
      } else {
        // 重設按鈕狀態
        btnConnect.disabled = false;
        btnConnect.textContent = '驗證並連線載入';
        token = '';
      }
    }
  }

  // 啟動本地 Demo 測試模式 (免 Token)
  async function startDemoMode() {
    isDemoMode = true;
    connectionStatus.textContent = '本地展示與測試模式 (唯讀)';
    
    // 1. 讀取本地的 games.json
    try {
      const localResponse = await fetch('games.json?t=' + Date.now());
      if (localResponse.ok) {
        gamesList = await localResponse.json();
      } else {
        gamesList = [
          {
            id: 'celeste',
            title: 'Celeste Classic',
            description: '攀登高峰的經典 PICO-8 遊戲。',
            instructions: '方向鍵移動，Z跳躍，X衝刺。',
            cartUrl: 'https://www.lexaloffle.com/bbs/widget.php?pid=11722',
            coverImage: 'assets/celeste_cover.png',
            tags: ['動作', '經典']
          }
        ];
      }
    } catch (e) {
      gamesList = [];
    }

    // 2. 模擬 games/ 下的子目錄 (包含已登記的 celeste、以及未登記的新目錄)
    foldersList = ['celeste', 'jelpi', 'retro-space-shooter', 'my-adventure-game'];

    // 模擬偵測結果
    detectedHtmlFiles['retro-space-shooter'] = 'shooter.html';
    detectedHtmlFiles['my-adventure-game'] = 'index.html';
    detectedCoverFiles['retro-space-shooter'] = 'label.png'; // 模擬偵測到的標籤圖

    compareAndBuildList();
    
    authPanel.style.display = 'none';
    adminPanel.style.display = 'block';
    showToast('已進入本地 Demo 測試模式！');
  }

  // 3. 自動比對：比對子目錄與 games.json，合併並建立總清單
  function compareAndBuildList() {
    activeList = [];

    // 先加入 games.json 中已有的遊戲
    gamesList.forEach(game => {
      activeList.push({
        ...game,
        isNewDetected: false
      });
    });

    // 巡檢 foldersList 中的資料夾名稱是否已存在於 games.json 中
    foldersList.forEach(folderName => {
      const exists = gamesList.some(game => game.id === folderName);
      if (!exists) {
        // 判定為新遊戲，自動生成預設資料
        activeList.push({
          id: folderName,
          title: folderName, // 預設名稱為該資料夾名稱
          description: '',
          instructions: '',
          cartUrl: `games/${folderName}/${detectedHtmlFiles[folderName] || 'index.html'}`, // 動態偵測到的 HTML 檔名
          coverImage: `games/${folderName}/${detectedCoverFiles[folderName] || 'cover.png'}`, // 動態偵測到的封面圖片檔名
          tags: ['新偵測到'],
          isNewDetected: true
        });
      }
    });

    // 排序：將新偵測到的遊戲排在前面，方便使用者編輯
    activeList.sort((a, b) => {
      if (a.isNewDetected && !b.isNewDetected) return -1;
      if (!a.isNewDetected && b.isNewDetected) return 1;
      return a.id.localeCompare(b.id);
    });

    // 更新統計看板
    const newCount = activeList.filter(g => g.isNewDetected).length;
    const regCount = activeList.length - newCount;
    
    statRegistered.textContent = regCount;
    statNew.textContent = newCount;
    statTotal.textContent = activeList.length;

    // 渲染表單與側邊導覽
    renderForms();
    renderQuickNav();
  }

  // 4. 動態渲染每個遊戲的專屬編輯表單卡片
  function renderForms() {
    gamesFormsContainer.innerHTML = '';

    if (activeList.length === 0) {
      gamesFormsContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-secondary); padding: 3rem;" class="admin-card">
          📭 沒有偵測到任何遊戲目錄，且 games.json 清單為空。
        </div>
      `;
      return;
    }

    activeList.forEach((game, index) => {
      const card = document.createElement('div');
      // 根據狀態套用不同 CSS 樣式 class
      card.className = `game-form-card ${game.isNewDetected ? 'new-detected' : 'registered'}`;
      card.id = `form-card-${game.id}`;

      const statusBadgeHtml = game.isNewDetected 
        ? `<span class="status-badge new">✨ 新偵測到</span>`
        : `<span class="status-badge reg">已登錄</span>`;

      // 組合標籤文字
      const tagsString = game.tags ? game.tags.join(', ') : '';

      card.innerHTML = `
        <div class="game-form-header">
          <h3>[${game.id}] ${game.title}</h3>
          ${statusBadgeHtml}
        </div>
        
        <form id="raw-form-${game.id}" onsubmit="return false;">
          <div class="form-row">
            <div class="form-group">
              <label>遊戲唯一代碼 (ID / 資料夾名稱)</label>
              <input type="text" id="input-id-${game.id}" class="form-control" value="${game.id}" readonly style="background-color: var(--bg-primary); cursor: not-allowed; border-color: rgba(255,255,255,0.05);">
            </div>
            <div class="form-group">
              <label>遊戲顯示名稱 (Title)</label>
              <input type="text" id="input-title-${game.id}" class="form-control" value="${game.title}" required placeholder="請輸入遊戲標題">
            </div>
          </div>

          <div class="form-group">
            <label>遊戲詳細介紹 (Description)</label>
            <textarea id="input-desc-${game.id}" class="form-control" rows="3" required placeholder="請輸入遊戲特色與背景介紹...">${game.description || ''}</textarea>
          </div>

          <div class="form-group">
            <label>操作玩法說明 (Instructions)</label>
            <textarea id="input-inst-${game.id}" class="form-control" rows="2" required placeholder="例如: 【方向鍵】移動，【Z】跳躍...">${game.instructions || ''}</textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>PICO-8 執行連結 (Cart URL)</label>
              <input type="text" id="input-url-${game.id}" class="form-control" value="${game.cartUrl || ''}" required placeholder="例如: games/${game.id}/index.html 或 games/${game.id}/${game.id}.html">
            </div>
            <div class="form-group">
              <label>封面圖片路徑 (Cover Image URL/Path)</label>
              <input type="text" id="input-cover-${game.id}" class="form-control" value="${game.coverImage || ''}" required placeholder="例如: assets/cover.png 或 games/.../cover.png">
            </div>
          </div>

          <div class="form-group">
            <label>分類標籤 (Tags，多個以半形逗號分隔)</label>
            <input type="text" id="input-tags-${game.id}" class="form-control" value="${tagsString}" placeholder="例如: 動作, 平台跳躍, 復古">
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 1.25rem;">
            <div>
              ${game.isNewDetected 
                ? `<small style="color: var(--color-success);">儲存後將正式寫入 games.json 設定檔</small>` 
                : `<button type="button" class="btn-danger" id="btn-delete-${game.id}">🗑️ 從設定檔刪除</button>`
              }
            </div>
            <button type="submit" class="btn-primary" id="btn-save-${game.id}">💾 儲存此遊戲變更</button>
          </div>
        </form>
      `;

      gamesFormsContainer.appendChild(card);

      // 監聽個別表單的儲存事件
      const saveBtn = card.querySelector(`#btn-save-${game.id}`);
      saveBtn.addEventListener('click', () => saveSingleGame(game.id, index));

      // 監聽個別表單的刪除事件
      if (!game.isNewDetected) {
        const deleteBtn = card.querySelector(`#btn-delete-${game.id}`);
        deleteBtn.addEventListener('click', () => deleteSingleGame(game.id));
      }
    });
  }

  // 5. 渲染側邊欄快速巡覽連結
  function renderQuickNav() {
    quickNavLinks.innerHTML = '';
    
    if (activeList.length === 0) {
      quickNavLinks.innerHTML = '<span style="color: var(--text-secondary); font-size: 0.85rem;">暫無項目</span>';
      return;
    }

    activeList.forEach(game => {
      const link = document.createElement('a');
      link.href = `#form-card-${game.id}`;
      link.className = `quick-link-item ${game.isNewDetected ? 'new-item' : 'reg-item'}`;
      
      const badgeText = game.isNewDetected ? '新' : '已登';
      const badgeStyle = game.isNewDetected ? 'color: var(--color-success);' : 'color: #b388ff;';

      link.innerHTML = `
        <span>👾 ${game.title}</span>
        <span style="font-size: 0.7rem; font-weight: 700; ${badgeStyle}">[${badgeText}]</span>
      `;

      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(`form-card-${game.id}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // 短暫閃爍突顯目標卡片
          target.style.borderColor = game.isNewDetected ? 'var(--color-success)' : 'var(--color-purple)';
          target.style.boxShadow = '0 0 25px rgba(138, 43, 226, 0.3)';
          setTimeout(() => {
            target.style.borderColor = '';
            target.style.boxShadow = '';
          }, 1500);
        }
      });

      quickNavLinks.appendChild(link);
    });
  }

  // 6. 單一遊戲表單儲存邏輯 (更新資料並覆寫寫入 GitHub/本地測試)
  async function saveSingleGame(gameIdKey, activeIndex) {
    // 獲取該表單內的欄位值
    const titleInput = document.getElementById(`input-title-${gameIdKey}`);
    const descInput = document.getElementById(`input-desc-${gameIdKey}`);
    const instInput = document.getElementById(`input-inst-${gameIdKey}`);
    const urlInput = document.getElementById(`input-url-${gameIdKey}`);
    const coverInput = document.getElementById(`input-cover-${gameIdKey}`);
    const tagsInput = document.getElementById(`input-tags-${gameIdKey}`);

    const titleVal = titleInput.value.trim();
    const descVal = descInput.value.trim();
    const instVal = instInput.value.trim();
    const urlVal = urlInput.value.trim();
    const coverVal = coverInput.value.trim();
    
    // 解析逗號標籤
    const tagsVal = tagsInput.value.trim()
      ? tagsInput.value.split(',').map(t => t.trim()).filter(t => t.length > 0)
      : [];

    if (!titleVal || !descVal || !instVal || !urlVal || !coverVal) {
      showToast('請完整填妥本機台的必要欄位！', true);
      const invalidField = !titleVal ? titleInput : (!descVal ? descInput : (!instVal ? instInput : (!urlVal ? urlInput : coverInput)));
      invalidField.focus();
      return;
    }

    // 建立欲寫入的乾淨遊戲物件 (排除 UI 輔助用的 isNewDetected)
    const updatedGameData = {
      id: gameIdKey,
      title: titleVal,
      description: descVal,
      instructions: instVal,
      cartUrl: urlVal,
      coverImage: coverVal,
      tags: tagsVal
    };

    // 更新記憶體中的 gamesList 陣列
    const existingIndex = gamesList.findIndex(g => g.id === gameIdKey);
    if (existingIndex !== -1) {
      // 修改現有遊戲
      gamesList[existingIndex] = updatedGameData;
    } else {
      // 將新偵測到的遊戲追加登錄進陣列
      gamesList.push(updatedGameData);
    }

    // 執行寫入覆寫 games.json
    if (isDemoMode) {
      showToast(`[Demo 模擬] 儲存變更成功！已更新遊戲 "${titleVal}"`);
      // 模擬重整資料狀態
      compareAndBuildList();
    } else {
      await writeGamesJsonToGithub(`Update game details: ${titleVal}`);
    }
  }

  // 7. 刪除現有遊戲並覆寫寫入
  async function deleteSingleGame(gameIdKey) {
    const targetGame = gamesList.find(g => g.id === gameIdKey);
    if (!targetGame) return;

    if (!confirm(`確定要將「${targetGame.title}」自 games.json 中移除？\n這將會使前台網頁不再顯示該遊戲卡片。`)) {
      return;
    }

    // 從 gamesList 中過濾掉此項目
    gamesList = gamesList.filter(g => g.id !== gameIdKey);

    if (isDemoMode) {
      showToast(`[Demo 模擬] 已自設定檔移除「${targetGame.title}」`);
      compareAndBuildList();
    } else {
      await writeGamesJsonToGithub(`Delete game: ${targetGame.title}`);
    }
  }

  // 8. 核心儲存：將最新記憶體中的 gamesList 寫入至 GitHub 的 games.json
  async function writeGamesJsonToGithub(commitMsg) {
    if (!token || !fileSha) {
      showToast('認證資訊或檔案 SHA 遺失，請嘗試重新登入。', true);
      return;
    }

    // 找出目前點擊的按鈕並顯示 loading 狀態
    const allButtons = document.querySelectorAll('button');
    allButtons.forEach(btn => btn.disabled = true);

    const jsonString = JSON.stringify(gamesList, null, 2);
    // 使用 UTF-8 安全編碼為 Base64
    const base64Content = encodeBase64Utf8(jsonString);

    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.path}`;
    const body = {
      message: commitMsg,
      content: base64Content,
      sha: fileSha,
      branch: config.branch
    };

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || `API 回傳錯誤: ${response.status}`);
      }

      const resData = await response.json();
      // 更新本機的 fileSha 供下次提交使用
      fileSha = resData.content.sha;
      
      showToast('🎉 設定檔更新成功！變更已推送至 GitHub。');

      // 重新比對並繪製表單 (使新登記的遊戲轉為 "已登記" 狀態樣式)
      compareAndBuildList();

    } catch (err) {
      console.error(err);
      showToast(`儲存失敗: ${err.message}`, true);
    } finally {
      // 復原所有按鈕狀態
      document.querySelectorAll('button').forEach(btn => {
        // 如果是 Demo 模式或登出狀態，要依邏輯保留禁用，但這裡是 API 呼叫，正常復原即可
        btn.disabled = false;
      });
    }
  }

  // 9. 中斷連線與登出
  function logout() {
    if (confirm('確定要登出並中斷連線嗎？未儲存的表單變更將會遺失。')) {
      // 清除快取憑證
      localStorage.removeItem('pico8_github_token');
      localStorage.removeItem('pico8_github_config');

      // 還原狀態變數
      token = '';
      config = { owner: '', repo: '', branch: 'main', path: 'games.json' };
      gamesList = [];
      foldersList = [];
      activeList = [];
      fileSha = '';
      isDemoMode = false;

      // 還原登入輸入欄位與按鈕
      githubToken.value = '';
      repoOwner.value = '';
      repoName.value = '';
      repoBranch.value = 'main';
      filePath.value = 'games.json';
      
      btnConnect.disabled = false;
      btnConnect.textContent = '驗證並連線載入';

      // 還原面板顯示
      adminPanel.style.display = 'none';
      authPanel.style.display = 'block';
      showToast('已登出後台。');
    }
  }

  // 事件綁定
  authForm.addEventListener('submit', connectToGithub);
  btnLogout.addEventListener('click', logout);

  // 自動執行初始化憑證偵測
  loadSavedCredentials();
});
