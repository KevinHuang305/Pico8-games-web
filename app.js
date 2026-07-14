// 前台邏輯 app.js

document.addEventListener('DOMContentLoaded', () => {
  // DOM 元素選取
  const gamesGrid = document.getElementById('gamesGrid');
  const gameModal = document.getElementById('gameModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalCover = document.getElementById('modalCover');
  const modalCartridge = document.getElementById('modalCartridge');
  const modalCartridgeTitle = document.getElementById('modalCartridgeTitle');
  const modalDescription = document.getElementById('modalDescription');
  const modalInstructions = document.getElementById('modalInstructions');
  const startGameBtn = document.getElementById('startGameBtn');
  const stopGameBtn = document.getElementById('stopGameBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const gameInfoWrapper = document.getElementById('gameInfoWrapper');
  const gamePlayerContainer = document.getElementById('gamePlayerContainer');
  const gameIframe = document.getElementById('gameIframe');
  const toast = document.getElementById('toastNotification');

  let gamesData = [];
  let activeGame = null;

  // 顯示 Toast 訊息
  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // 初始化載入遊戲資料
  async function loadGames() {
    try {
      const response = await fetch('games.json?t=' + Date.now());
      if (!response.ok) {
        throw new Error(`無法載入遊戲資料，狀態碼: ${response.status}`);
      }
      gamesData = await response.json();
      renderGames(gamesData);
    } catch (error) {
      console.error(error);
      gamesGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: var(--pico-red); padding: 3rem;">
          ❌ 載入遊戲機台失敗，請確認 games.json 檔案是否存在並格式正確。<br>
          <small style="color: var(--text-secondary); margin-top: 10px; display: block;">${error.message}</small>
        </div>
      `;
      showToast('載入遊戲資料失敗', true);
    }
  }

  // 渲染遊戲卡片 Grid
  function renderGames(games) {
    if (games.length === 0) {
      gamesGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 3rem;">
          🕹️ 目前還沒有遊戲上架喔！
        </div>
      `;
      return;
    }

    gamesGrid.innerHTML = '';
    games.forEach(game => {
      const card = document.createElement('div');
      card.className = 'game-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `查看 ${game.title}`);

      // 產生標籤 HTML
      const tagsHtml = game.tags && game.tags.length > 0
        ? game.tags.map(tag => `<span class="tag">${tag}</span>`).join('')
        : '';

      // 檢查是否有有效的封面圖片
      const hasCover = game.coverImage && game.coverImage.trim() !== '' && !game.coverImage.includes('placeholder.png');
      const coverImageHtml = hasCover
        ? `<img src="${game.coverImage}" alt="${game.title}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
           <div class="pico-cartridge" style="display: none;">
             <div class="pico-cartridge-label">
               <div class="pico-cartridge-title">${game.title}</div>
               <div class="pico-cartridge-logo">PICO-8 CART</div>
             </div>
             <div class="pico-cartridge-bottom"></div>
           </div>`
        : `<div class="pico-cartridge">
             <div class="pico-cartridge-label">
               <div class="pico-cartridge-title">${game.title}</div>
               <div class="pico-cartridge-logo">PICO-8 CART</div>
             </div>
             <div class="pico-cartridge-bottom"></div>
           </div>`;

      card.innerHTML = `
        <div class="card-img-wrapper">
          ${coverImageHtml}
        </div>
        <div class="card-content">
          <h3 class="card-title">${game.title}</h3>
          <p class="card-description">${game.description}</p>
          <div class="card-tags">
            ${tagsHtml}
          </div>
        </div>
      `;

      // 點擊事件
      card.addEventListener('click', () => openModal(game));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openModal(game);
        }
      });

      gamesGrid.appendChild(card);
    });
  }

  // 開啟詳細資料 Modal
  function openModal(game) {
    activeGame = game;
    modalTitle.textContent = game.title;
    
    // 處理彈窗封面與卡帶降級顯示
    const hasCover = game.coverImage && game.coverImage.trim() !== '' && !game.coverImage.includes('placeholder.png');
    modalCartridgeTitle.textContent = game.title;
    
    if (hasCover) {
      modalCover.style.display = 'block';
      modalCartridge.style.display = 'none';
      modalCover.src = game.coverImage;
      modalCover.onerror = function() {
        modalCover.style.display = 'none';
        modalCartridge.style.display = 'flex';
      };
    } else {
      modalCover.style.display = 'none';
      modalCartridge.style.display = 'flex';
    }

    modalDescription.textContent = game.description || '無詳細介紹。';
    modalInstructions.textContent = game.instructions || '無操作說明。';

    // 重設 Modal 內部顯示狀態
    gameInfoWrapper.style.display = 'grid';
    gamePlayerContainer.style.display = 'none';
    gameIframe.src = '';
    gameIframe.onload = null; // 移除之前的 onload 監聽

    gameModal.classList.add('active');
    document.body.style.overflow = 'hidden'; // 鎖定背景捲軸
  }

  // 關閉 Modal
  function closeModal() {
    gameModal.classList.remove('active');
    document.body.style.overflow = ''; // 恢復背景捲軸
    
    // 立即停止遊戲執行與聲音
    gameIframe.onload = null;
    gameIframe.src = '';
    activeGame = null;
  }

  // 開始遊戲
  function startGame() {
    if (!activeGame || !activeGame.cartUrl) {
      showToast('此遊戲沒有可用的遊玩連結', true);
      return;
    }

    // 1. 切換顯示模式為播放器
    gameInfoWrapper.style.display = 'none';
    gamePlayerContainer.style.display = 'block';

    // 2. 監聽 Iframe 載入事件，載入完成後自動聚焦
    gameIframe.onload = () => {
      // 給予一些延遲時間，確保 Iframe 內部渲染引擎開始載入
      setTimeout(() => {
        // A. 聚焦 Iframe 的 DOM 元素 (大部分瀏覽器有效)
        gameIframe.focus();
        
        // B. 嘗試聚焦 Iframe 內部的 window 物件 (處理跨域安全)
        try {
          if (gameIframe.contentWindow) {
            gameIframe.contentWindow.focus();
          }
        } catch (e) {
          console.warn('Iframe contentWindow focus block (CORS):', e.message);
        }
        
        showToast(`🕹️ 已連線！可以直接使用鍵盤控制遊戲`);
      }, 150);
    };

    // 3. 載入遊戲網址
    gameIframe.src = activeGame.cartUrl;
    showToast(`正在啟動 ${activeGame.title} 機台...`);
  }

  // 停止遊戲
  function stopGame() {
    gameIframe.onload = null;
    gameIframe.src = '';
    gamePlayerContainer.style.display = 'none';
    gameInfoWrapper.style.display = 'grid';
    
    // 將焦點還原到 Modal 內部主按鈕上
    startGameBtn.focus();
  }

  // 事件監聽器設定
  closeModalBtn.addEventListener('click', closeModal);
  
  // 點擊彈窗外部背景關閉
  gameModal.addEventListener('click', (e) => {
    if (e.target === gameModal) {
      closeModal();
    }
  });

  // 監聽鍵盤 ESC 鍵關閉彈窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gameModal.classList.contains('active')) {
      closeModal();
    }
  });

  startGameBtn.addEventListener('click', startGame);
  stopGameBtn.addEventListener('click', stopGame);

  // 啟動載入
  loadGames();
});
