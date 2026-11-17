<script>
  import { onMount } from 'svelte';
  import { isTauri } from './lib/tauri.js';
  import { 
    appState, 
    checkForUpdates,
    installUpdate,
    navigate,
    checkAuthStatus,
    fetchTasks,
    initMainChatGreeting,
    switchActiveTask,
    fetchPartners,
    fetchDepartments,
    fetchMembers,
    fetchProducts,
    fetchWarehouses,
    fetchAuditLogs
  } from './lib/store.svelte.js';
  import { resolveRouteComponent } from './lib/routes.js';
  import TaskPanel from './lib/components/TaskPanel.svelte';
  import Breadcrumb from './lib/components/Breadcrumb.svelte';
  import StatusOverview from './lib/components/StatusOverview.svelte';
  import LoginScreen from './lib/components/auth/LoginScreen.svelte';
  import RegisterWizard from './lib/components/auth/RegisterWizard.svelte';
  import TenantPicker from './lib/components/auth/TenantPicker.svelte';
  import OnboardingScreen from './lib/components/auth/OnboardingScreen.svelte';
  import CreateWarehouseModal from './lib/warehouses/CreateWarehouseModal.svelte';

  let activeTab = $derived(appState.activeWorkspace);
  let isNotificationOpen = $state(false);
  let initializedKey = $state('');

  let ActiveWorkspace = $derived(resolveRouteComponent(appState.route));

  async function initializeAppData(force = false) {
    const currentKey = `${appState.authUser?.id || ''}_${appState.activeTenant?.id || ''}`;
    if (!force && initializedKey === currentKey && currentKey !== '_') return;

    await fetchAuditLogs();
    await fetchTasks();
    await fetchPartners();
    await fetchDepartments();
    await fetchMembers();
    await fetchProducts();
    await fetchWarehouses();
    await initMainChatGreeting();
    initializedKey = currentKey;
  }

  onMount(async () => {
    if (isTauri) {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        appState.version = await getVersion();
      } catch (err) {
        console.warn("Failed to fetch version from Tauri:", err);
      }
    } else {
      appState.version = '0.1.0';
    }

    // Check auth status first
    const auth = await checkAuthStatus();

    if (auth.status === 'unauthenticated') {
      if (appState.route !== '/register') {
        navigate('/login');
      }
    } else if (auth.status === 'needs_tenant_creation') {
      navigate('/onboarding');
    } else if (auth.status === 'needs_tenant_selection') {
      navigate('/select-tenant');
    } else {
      // Authenticated
      if (appState.route === '/login' || appState.route === '/register') {
        navigate('/app/agent');
      }
      await initializeAppData();
    }

    // Hash router synchronization
    const handleHashChange = async () => {
      const hash = location.hash.slice(1);
      if (!hash) {
        if (appState.authStatus === 'authenticated') {
          navigate('/app/agent');
        } else {
          navigate('/login');
        }
      } else {
        if (appState.authStatus === 'unauthenticated' && hash !== '/register') {
          navigate('/login');
        } else {
          appState.route = hash;
          if (appState.authStatus === 'authenticated') {
            await initializeAppData();
          }
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    // Initial sync
    await handleHashChange();

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  });

  function selectWorkspace(ws) {
    if (ws === 'agent') navigate('/app/agent');
    else if (ws === 'settings') navigate('/app/settings');
    else if (ws === 'purchase-orders') navigate('/app/purchase-orders');
    else if (ws === 'vendor-bills' || ws === 'bills') navigate('/app/vendor-bills');
    else if (ws === 'warehouses' || ws === 'warehouse') navigate('/app/warehouses');
    else if (ws === 'accounts-payable') navigate('/app/accounts-payable');
    else if (ws === 'quotes' || ws === 'quote') navigate('/app/quotes');
    else if (ws === 'sales-orders' || ws === 'sales-order') navigate('/app/sales-orders');
    else if (ws === 'customer-credit' || ws === 'customer-credits') navigate('/app/customer-credit');
    else if (ws === 'inventory') navigate('/app/inventory');
    else navigate(`/app/${ws}`);
  }

  function handleBrandLogoClick() {
    switchActiveTask(null);
    selectWorkspace('agent');
  }
</script>

{#if appState.route === '/login'}
  <LoginScreen />
{:else if appState.route === '/register'}
  <RegisterWizard />
{:else if appState.route === '/onboarding'}
  <OnboardingScreen />
{:else if appState.route === '/select-tenant'}
  <TenantPicker />
{:else}
  <div class="app-shell">
    <div class="shell-body">
      <!-- 1. Left Sidebar Rail (64px) -->
      <aside class="sidebar-rail">
        <div class="rail-top">
          <button class="rail-brand-logo" onclick={handleBrandLogoClick} title="回到主 Agent 環境對話">
            A
          </button>

          <nav class="rail-nav">
            <!-- AI Agent Chat / 主助理 -->
            <button 
              class="rail-nav-btn {activeTab === 'agent' ? 'active' : ''}" 
              onclick={() => selectWorkspace('agent')}
              title="AI 助理對話"
              aria-label="AI 助理對話"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>

            <!-- 採購單 (Issue #165) -->
            <button 
              class="rail-nav-btn {activeTab === 'purchase-orders' ? 'active' : ''}" 
              onclick={() => selectWorkspace('purchase-orders')}
              title="採購單"
              aria-label="採購單"
              id="rail-nav-purchase-orders"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
            </button>

            <!-- 請款單 (Issue #202) -->
            <button 
              class="rail-nav-btn {activeTab === 'vendor-bills' || activeTab === 'bills' ? 'active' : ''}" 
              onclick={() => selectWorkspace('vendor-bills')}
              title="請款單"
              aria-label="請款單"
              id="rail-nav-vendor-bills"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </button>

            <!-- 倉庫管理 (Issue #182) -->
            <button 
              class="rail-nav-btn {activeTab === 'warehouses' || activeTab === 'inventory' ? 'active' : ''}" 
              onclick={() => selectWorkspace('warehouses')}
              title="倉庫管理"
              aria-label="倉庫管理"
              id="rail-nav-warehouses"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </button>

            <!-- 應付帳款 (Issue #200) -->
            <button 
              class="rail-nav-btn {activeTab === 'accounts-payable' ? 'active' : ''}" 
              onclick={() => selectWorkspace('accounts-payable')}
              title="應付帳款"
              aria-label="應付帳款"
              id="rail-nav-accounts-payable"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="20" height="14" x="2" y="5" rx="2"></rect>
                <line x1="2" x2="22" y1="10" y2="10"></line>
              </svg>
            </button>

            <!-- 報價單 (Issue #233) -->
            <button 
              class="rail-nav-btn {activeTab === 'quotes' || activeTab === 'quote' ? 'active' : ''}" 
              onclick={() => selectWorkspace('quotes')}
              title="報價單"
              aria-label="報價單"
              id="rail-nav-quotes"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                <path d="M9 14h6"></path>
                <path d="M9 18h6"></path>
                <path d="M9 10h6"></path>
              </svg>
            </button>

            <!-- 銷售單 (Issue #221) -->
            <button
              class="rail-nav-btn {activeTab === 'sales-orders' || activeTab === 'sales-order' ? 'active' : ''}"
              onclick={() => selectWorkspace('sales-orders')}
              title="銷售單"
              aria-label="銷售單"
              id="rail-nav-sales-orders"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1" y="3" width="15" height="13" rx="1"></rect>
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                <circle cx="5.5" cy="18.5" r="2.5"></circle>
                <circle cx="18.5" cy="18.5" r="2.5"></circle>
              </svg>
            </button>

            <!-- 客戶信用 (Issue #219 / M14 應收工作區) -->
            <button
              class="rail-nav-btn {activeTab === 'customer-credit' || activeTab === 'customer-credits' ? 'active' : ''}"
              onclick={() => selectWorkspace('customer-credit')}
              title="客戶信用"
              aria-label="客戶信用"
              id="rail-nav-customer-credit"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="m9 12 2 2 4-4"></path>
              </svg>
            </button>

            <!-- Settings icon -->
            <button 
              class="rail-nav-btn {activeTab === 'settings' ? 'active' : ''}" 
              onclick={() => selectWorkspace('settings')}
              title="設定與防禦管理"
              aria-label="設定與防禦管理"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
          </nav>
        </div>

        <div class="rail-bottom">
          <!-- Notification Bell -->
          <button class="rail-notif-btn" onclick={() => isNotificationOpen = !isNotificationOpen} title="通知中心" aria-label="通知中心">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            {#if appState.notifications.length > 0}
              <span class="rail-badge">{appState.notifications.length}</span>
            {/if}
          </button>
        </div>
      </aside>

      <!-- 2. Collapsible Task Panel -->
      <TaskPanel />

      <!-- 3. Central Area (Breadcrumb + Dynamic Workspace) -->
      <div class="shell-workspace-area">
        <div class="agent-main-container">
          <Breadcrumb />

          {#if appState.updateAvailable}
            <div class="update-banner glass-panel">
              <div class="update-banner-header">
                <span class="badge badge-amber">系統更新可用</span>
                <h4>主程式發現新版本 (v0.2.0)</h4>
              </div>
              <p class="update-notes-preview">{appState.updateNotes}</p>
              
              <div class="update-action-row">
                {#if appState.updateStatus === 'idle'}
                  <button class="btn btn-primary" onclick={installUpdate}>
                    立刻下載並更新 (Download & Install)
                  </button>
                {:else if appState.updateStatus === 'downloading'}
                  <div class="update-progress-layout">
                    <span class="progress-percent">正在下載：{appState.updateProgress.percent}% ({(appState.updateProgress.downloaded / 1024 / 1024).toFixed(2)} MB / 2.34 MB)</span>
                    <div class="progress-bar-container">
                      <div class="progress-bar-fill" style="width: {appState.updateProgress.percent}%"></div>
                    </div>
                  </div>
                {:else if appState.updateStatus === 'finished'}
                  <div class="relaunch-status">
                    <span class="spinner-icon"></span>
                    <span>下載完成，正在重啟並套用主程式更新...</span>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Dynamic Workspace Component from Route Table -->
          <ActiveWorkspace />
        </div>

        <!-- 4. Right Status Overview Panel -->
        <StatusOverview />
      </div>
    </div>

    <!-- 5. Bottom Statusbar (28px) -->
    <footer class="shell-statusbar">
      <div class="statusbar-left">
        <span class="statusbar-dot"></span>
        <span>邊緣資料庫：SQLite 已連線</span>
      </div>
      <div class="statusbar-right">
        <span>Provider: NVIDIA NIM</span>
      </div>
    </footer>

    <!-- Global Create Warehouse Modal (M12 Single Entry) -->
    <CreateWarehouseModal />
  </div>
{/if}

<!-- Toast Popup Notification (UX feedback for update checker) -->
{#if appState.toastMessage}
  <div class="toast-popup glass-panel">
    <div class="toast-body">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: rgb(74, 222, 128);"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <span>{appState.toastMessage}</span>
    </div>
  </div>
{/if}

<style>
  /* Updater Banner */
  .update-banner {
    border-color: rgba(var(--accent-amber), 0.3);
    background: rgba(var(--accent-amber), 0.03);
    padding: 16px 20px;
    margin: 16px 24px 0;
    flex-shrink: 0;
    animation: slideIn var(--transition-smooth) forwards;
  }

  .update-banner-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }

  .update-notes-preview {
    font-size: 0.88rem;
    color: var(--text-secondary);
    white-space: pre-wrap;
    margin-bottom: 12px;
  }

  .update-action-row {
    display: flex;
    align-items: center;
  }

  .update-progress-layout {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .progress-percent {
    font-size: 0.85rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .progress-bar-container {
    width: 100%;
    height: 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    overflow: hidden;
    position: relative;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    width: 0%;
    transition: width 0.1s linear;
  }

  .relaunch-status {
    display: flex;
    align-items: center;
    gap: 10px;
    color: rgb(var(--accent-amber));
    font-weight: 500;
  }

  .spinner-icon {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(var(--accent-amber), 0.3);
    border-top-color: rgb(var(--accent-amber));
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Toast Popup Styles */
  .toast-popup {
    position: fixed;
    bottom: 36px;
    right: 24px;
    z-index: 9999;
    padding: 12px 20px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(18, 18, 18, 0.85);
    backdrop-filter: blur(16px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .toast-body {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
    color: var(--text-primary);
    font-weight: 500;
  }
</style>
