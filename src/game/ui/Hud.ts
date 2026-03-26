import * as THREE from 'three';

type Callback = () => void;

export class Hud {
  private readonly rootEl: HTMLElement;

  private mainPanel: HTMLDivElement;
  private gameOverPanel: HTMLDivElement;
  private winPanel: HTMLDivElement;
  private overlay: HTMLDivElement;
  private errorLine: HTMLDivElement;

  private startBtn: HTMLButtonElement;
  private restartBtn: HTMLButtonElement;
  private skipBtn: HTMLButtonElement;

  private keyIndicator: HTMLDivElement;
  private messageEl: HTMLDivElement;
  private messageTimeout: number | null = null;
  private interactPrompt: HTMLDivElement;
  private crosshair: HTMLDivElement;

  private onStartCb: ((level: 'default' | 'kenney') => void) | null = null;
  private onRestartCb: Callback | null = null;
  private onSkipCb: Callback | null = null;
  private selectedLevel: 'default' | 'kenney' = 'default';

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl;

    const hudRoot = document.createElement('div');
    hudRoot.className = 'hud';

    // Main menu
    this.mainPanel = document.createElement('div');
    this.mainPanel.className = 'panel';
    this.mainPanel.innerHTML = `
      <div class="title">Покинутий Садок</div>
      <div style="opacity:0.9; margin-bottom: 14px; font-size: 14px; line-height: 1.35;">
        Знайди вихід з покинутого садка.<br/>
        Годинник допоможе тобі в темряві.<br/>
        <span style="opacity:0.6; font-size:12px;">Джойстик — рух, тягни екран — огляд</span>
      </div>
    `;

    // Level selector
    const levelSelect = document.createElement('div');
    levelSelect.style.marginBottom = '12px';
    levelSelect.style.display = 'flex';
    levelSelect.style.gap = '8px';
    levelSelect.style.justifyContent = 'center';

    const btnDefault = document.createElement('button');
    btnDefault.textContent = 'Садок';
    btnDefault.className = 'level-btn active';
    const btnKenney = document.createElement('button');
    btnKenney.textContent = 'Kenney';
    btnKenney.className = 'level-btn';

    btnDefault.addEventListener('click', () => {
      this.selectedLevel = 'default';
      btnDefault.classList.add('active');
      btnKenney.classList.remove('active');
    });
    btnKenney.addEventListener('click', () => {
      this.selectedLevel = 'kenney';
      btnKenney.classList.add('active');
      btnDefault.classList.remove('active');
    });

    levelSelect.appendChild(btnDefault);
    levelSelect.appendChild(btnKenney);
    this.mainPanel.appendChild(levelSelect);

    this.startBtn = document.createElement('button');
    this.startBtn.textContent = 'Грати';
    this.startBtn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      this.onStartCb?.(this.selectedLevel);
    });
    this.mainPanel.appendChild(this.startBtn);

    this.errorLine = document.createElement('div');
    this.errorLine.style.marginTop = '12px';
    this.errorLine.style.fontSize = '12px';
    this.errorLine.style.lineHeight = '1.35';
    this.errorLine.style.color = 'rgba(255,255,255,0.85)';
    this.errorLine.style.opacity = '0.95';
    this.errorLine.style.whiteSpace = 'pre-wrap';
    this.errorLine.style.display = 'none';
    this.mainPanel.appendChild(this.errorLine);

    // Game over
    this.gameOverPanel = document.createElement('div');
    this.gameOverPanel.className = 'panel';
    this.gameOverPanel.style.display = 'none';
    this.gameOverPanel.innerHTML = `
      <div class="title">Тебе спіймали...</div>
      <div style="opacity:0.9; margin-bottom: 14px; font-size: 14px;">
        Монстр дістав тебе.
      </div>
    `;

    this.restartBtn = document.createElement('button');
    this.restartBtn.textContent = 'Ще раз';
    this.restartBtn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      this.onRestartCb?.();
    });
    this.gameOverPanel.appendChild(this.restartBtn);

    this.skipBtn = document.createElement('button');
    this.skipBtn.textContent = 'В меню';
    this.skipBtn.style.marginLeft = '10px';
    this.skipBtn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      this.onSkipCb?.();
    });
    this.gameOverPanel.appendChild(this.skipBtn);

    // Win
    this.winPanel = document.createElement('div');
    this.winPanel.className = 'panel';
    this.winPanel.style.display = 'none';
    this.winPanel.innerHTML = `
      <div class="title">Ти врятувався!</div>
      <div style="opacity:0.9; margin-bottom: 14px; font-size: 14px;">
        Ти вибрався з покинутого садка.
      </div>
    `;

    const winRestart = document.createElement('button');
    winRestart.textContent = 'Грати знову';
    winRestart.addEventListener('pointerup', (e) => {
      e.preventDefault();
      this.onRestartCb?.();
    });
    this.winPanel.appendChild(winRestart);

    // Jumpscare overlay (CSS flash)
    this.overlay = document.createElement('div');
    this.overlay.className = 'jumpscareOverlay';

    // Touch hint (non-interactive)
    const hint = document.createElement('div');
    hint.className = 'touchHint';
    hint.textContent = 'Тягни екран щоб дивитись';

    // Key indicator (top-left)
    this.keyIndicator = document.createElement('div');
    this.keyIndicator.className = 'key-indicator';
    this.keyIndicator.innerHTML = '<span class="key-icon">&#128273;</span> <span class="key-text">---</span>';
    this.keyIndicator.style.display = 'none';

    // Message popup (center-bottom)
    this.messageEl = document.createElement('div');
    this.messageEl.className = 'game-message';

    // Crosshair (center dot)
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair';
    this.crosshair.style.display = 'none';

    // Interaction prompt
    this.interactPrompt = document.createElement('div');
    this.interactPrompt.className = 'interact-prompt';

    hudRoot.appendChild(this.mainPanel);
    hudRoot.appendChild(this.gameOverPanel);
    hudRoot.appendChild(this.winPanel);
    hudRoot.appendChild(this.overlay);
    hudRoot.appendChild(hint);
    hudRoot.appendChild(this.keyIndicator);
    hudRoot.appendChild(this.messageEl);
    hudRoot.appendChild(this.crosshair);
    hudRoot.appendChild(this.interactPrompt);

    this.rootEl.appendChild(hudRoot);
  }

  public onStart(cb: (level: 'default' | 'kenney') => void) {
    this.onStartCb = cb;
  }

  public onRestart(cb: Callback) {
    this.onRestartCb = cb;
  }

  public onSkipJumpscare(cb: Callback) {
    this.onSkipCb = cb;
  }

  public showMainMenu() {
    this.mainPanel.style.display = 'block';
    this.gameOverPanel.style.display = 'none';
    this.winPanel.style.display = 'none';
    this.errorLine.style.display = 'none';
    this.keyIndicator.style.display = 'none';
    this.crosshair.style.display = 'none';
    this.hideInteractPrompt();
  }

  public showPlaying() {
    this.mainPanel.style.display = 'none';
    this.gameOverPanel.style.display = 'none';
    this.winPanel.style.display = 'none';
    this.errorLine.style.display = 'none';
    this.keyIndicator.style.display = 'block';
    this.crosshair.style.display = 'block';
  }

  public showGameOver() {
    this.mainPanel.style.display = 'none';
    this.gameOverPanel.style.display = 'block';
    this.winPanel.style.display = 'none';
  }

  public showWin() {
    this.mainPanel.style.display = 'none';
    this.gameOverPanel.style.display = 'none';
    this.winPanel.style.display = 'block';
  }

  public triggerJumpscare() {
    this.overlay.classList.add('on');
    window.setTimeout(() => this.overlay.classList.remove('on'), 120);
  }

  public triggerEscapeEffect() {
    // Small UI flash to confirm exit.
    this.overlay.style.background = '#d9ffd9';
    this.triggerJumpscare();
    window.setTimeout(() => (this.overlay.style.background = '#fff'), 180);
  }

  public showError(message: string) {
    this.errorLine.textContent = `Error starting game:\n${message}\n\nOpen DevTools Console for full details.`;
    this.errorLine.style.display = 'block';
  }

  public setKeyStatus(hasKey: boolean) {
    if (hasKey) {
      this.keyIndicator.innerHTML = '<span class="key-icon">&#128273;</span> <span class="key-text key-found">Ключ</span>';
    } else {
      this.keyIndicator.innerHTML = '<span class="key-icon">&#128273;</span> <span class="key-text">---</span>';
    }
  }

  public showInteractPrompt(text: string) {
    this.interactPrompt.textContent = text;
    this.interactPrompt.style.opacity = '1';
    this.crosshair.classList.add('active');
  }

  public hideInteractPrompt() {
    this.interactPrompt.style.opacity = '0';
    this.crosshair.classList.remove('active');
  }

  public showMessage(text: string, durationMs: number) {
    this.messageEl.textContent = text;
    this.messageEl.style.opacity = '1';
    if (this.messageTimeout) clearTimeout(this.messageTimeout);
    this.messageTimeout = window.setTimeout(() => {
      this.messageEl.style.opacity = '0';
    }, durationMs);
  }
}

