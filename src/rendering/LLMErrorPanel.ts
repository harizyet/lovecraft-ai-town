export class LLMErrorPanel {
  private container: HTMLDivElement
  private closeButton: HTMLButtonElement
  private retryButton: HTMLButtonElement
  private onRetryCallback?: () => void
  private visible: boolean = false

  constructor(onRetry?: () => void) {
    this.onRetryCallback = onRetry
    this.container = document.createElement('div')
    this.container.id = 'llm-error-panel'
    this.container.setAttribute('role', 'alertdialog')
    this.container.setAttribute('aria-label', 'LLM Connection Failure')
    
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.95);
      width: min(520px, calc(100vw - 32px));
      display: none;
      flex-direction: column;
      background: rgba(15, 10, 25, 0.98);
      color: #f1eaff;
      border: 2px solid #ff5252;
      border-radius: 12px;
      box-shadow: 0 0 30px rgba(255, 82, 82, 0.25), 0 10px 50px rgba(0, 0, 0, 0.9);
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      overflow: hidden;
      z-index: 2000;
      pointer-events: auto;
      transition: transform 0.2s ease, opacity 0.2s ease;
      opacity: 0;
    `

    this.container.innerHTML = `
      <div style="padding:16px 20px;background:rgba(255, 82, 82, 0.15);border-bottom:1px solid rgba(255, 82, 82, 0.3);display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;line-height:1;color:#ff5252;">⚠️</span>
        <div style="color:#ff8a80;font-size:16px;font-weight:bold;letter-spacing:0.5px;">LLM Connection Failure</div>
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:14px;line-height:1.5;">
        <p style="color:#e0d6ff;margin:0;">
          The simulation has detected consistent failures communicating with the local LLM server. This usually happens when the local LLM host is not running or the endpoint is misconfigured.
        </p>
        
        <div style="background:rgba(20, 15, 35, 0.8);border:1px solid #4a3b6d;border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:8px;">
          <div><strong style="color:#b388ff;">Configured Endpoint:</strong> <code id="llm-error-endpoint" style="color:#ff8a80;background:rgba(0,0,0,0.2);padding:2px 4px;border-radius:3px;">-</code></div>
          <div><strong style="color:#b388ff;">Target Model:</strong> <code id="llm-error-model" style="color:#ff8a80;background:rgba(0,0,0,0.2);padding:2px 4px;border-radius:3px;">-</code></div>
          <div><strong style="color:#b388ff;">Consecutive Errors:</strong> <span id="llm-error-count" style="color:#ff5252;font-weight:bold;">-</span></div>
        </div>

        <div style="font-size:11px;color:#c1a8e8;background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;border-left:3px solid #b388ff;">
          <strong style="display:block;margin-bottom:4px;color:#f1eaff;">How to fix:</strong>
          1. Make sure your local server (e.g. LM Studio, Ollama, or LocalAI) is running.<br>
          2. Enable CORS and check that the server is listening on the configured port.<br>
          3. Ensure the model name matches the one configured in <code style="color:#e5d3ff;">src/main.ts</code>.
        </div>
      </div>
      <div style="padding:14px 20px;background:rgba(0,0,0,0.2);border-top:1px solid #332255;display:flex;justify-content:flex-end;gap:10px;">
        <button id="llm-error-dismiss" style="padding:8px 16px;border:1px solid #6d47b8;border-radius:6px;background:transparent;color:#b388ff;cursor:pointer;font:inherit;font-weight:bold;transition:all 0.15s ease;">
          Dismiss
        </button>
        <button id="llm-error-retry" style="padding:8px 18px;border:0;border-radius:6px;background:#ff5252;color:#1b0f33;cursor:pointer;font:inherit;font-weight:bold;transition:all 0.15s ease;box-shadow:0 2px 8px rgba(255,82,82,0.3);">
          Retry Connection
        </button>
      </div>
    `

    document.body.appendChild(this.container)

    this.closeButton = this.container.querySelector('#llm-error-dismiss') as HTMLButtonElement
    this.retryButton = this.container.querySelector('#llm-error-retry') as HTMLButtonElement

    this.setupListeners()
  }

  private setupListeners(): void {
    // Dismiss button hover & click
    this.closeButton.addEventListener('mouseenter', () => {
      this.closeButton.style.background = 'rgba(179, 136, 255, 0.1)'
      this.closeButton.style.borderColor = '#b388ff'
    })
    this.closeButton.addEventListener('mouseleave', () => {
      this.closeButton.style.background = 'transparent'
      this.closeButton.style.borderColor = '#6d47b8'
    })
    this.closeButton.addEventListener('click', () => {
      this.hide()
    })

    // Retry button hover & click
    this.retryButton.addEventListener('mouseenter', () => {
      this.retryButton.style.background = '#ff8a80'
      this.retryButton.style.boxShadow = '0 4px 12px rgba(255, 82, 82, 0.5)'
    })
    this.retryButton.addEventListener('mouseleave', () => {
      this.retryButton.style.background = '#ff5252'
      this.retryButton.style.boxShadow = '0 2px 8px rgba(255, 82, 82, 0.3)'
    })
    this.retryButton.addEventListener('click', () => {
      this.retryButton.disabled = true
      this.retryButton.textContent = 'Checking...'
      this.retryButton.style.opacity = '0.7'
      
      if (this.onRetryCallback) {
        this.onRetryCallback()
      }

      // Briefly disable to prevent double-clicks
      setTimeout(() => {
        this.retryButton.disabled = false
        this.retryButton.textContent = 'Retry Connection'
        this.retryButton.style.opacity = '1'
      }, 1000)
    })
  }

  public show(endpoint: string, model: string, consecutiveFailures: number): void {
    if (this.visible) {
      // Just update counts if already open
      const countEl = this.container.querySelector('#llm-error-count')
      if (countEl) countEl.textContent = String(consecutiveFailures)
      return
    }

    const endpointEl = this.container.querySelector('#llm-error-endpoint')
    const modelEl = this.container.querySelector('#llm-error-model')
    const countEl = this.container.querySelector('#llm-error-count')

    if (endpointEl) endpointEl.textContent = endpoint
    if (modelEl) modelEl.textContent = model
    if (countEl) countEl.textContent = String(consecutiveFailures)

    this.container.style.display = 'flex'
    // Force a reflow to trigger CSS transitions
    void this.container.offsetWidth
    
    this.container.style.transform = 'translate(-50%, -50%) scale(1)'
    this.container.style.opacity = '1'
    this.visible = true
  }

  public hide(): void {
    if (!this.visible) return
    this.container.style.transform = 'translate(-50%, -50%) scale(0.95)'
    this.container.style.opacity = '0'
    this.visible = false
    
    setTimeout(() => {
      if (!this.visible) {
        this.container.style.display = 'none'
      }
    }, 200)
  }
}
