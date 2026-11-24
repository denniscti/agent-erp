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
  import { getWorkspaceRoutePath, getTopLevelNavRoutes, isNavActive } from './lib/routes.js';
  import Icon from './lib/components/Icon.svelte';
  import TaskPanel from './lib/components/TaskPanel.svelte';
  import Breadcrumb from './lib/components/Breadcrumb.svelte';
  import StatusOverview from './lib/components/StatusOverview.svelte';
  import LoginScreen from './lib/components/auth/LoginScreen.svelte';
  import RegisterWizard from './lib/components/auth/RegisterWizard.svelte';
  import TenantPicker from './lib/components/auth/TenantPicker.svelte';
  import OnboardingScreen from './lib/components/auth/OnboardingScreen.svelte';
  import CreateWarehouseModal from './lib/warehouses/CreateWarehouseModal.svelte';

  let activeTab = $derived(appState.activeWorkspace);
  let topLevelNavItems = $derived(getTopLevelNavRoutes());
  let isNotificationOpen = $state(false);
  let initializedKey = $state('');

  // Async Workspace Resolution with Loading & Error States (Issue #264)
  let ActiveWorkspace = $state(null);
  let isWorkspaceLoading = $state(false);
  let workspaceLoadError = $state(null);
  let currentLoadedLoader = null;

  $effect(() => {
    const route = appState.route;
    const loader = resolveRouteComponent(route);

    // 若新路由解析到相同 loader 且已載入完成，直接保留原元件實例，避免子路由切換時重複 unmount/mount 造成狀態遺失
    if (loader && loader === currentLoadedLoader && ActiveWorkspace) {
      return;
    }

    isWorkspaceLoading = true;
    workspaceLoadError = null;
    ActiveWorkspace = null;
    let cancelled = false;

    if (!loader) {
      currentLoadedLoader = null;
      workspaceLoadError = new Error(`未找到工作區路由：${route}`);
      isWorkspaceLoading = false;
      return;
    }

    const handleLoaded = (mod) => {
      if (!cancelled) {
        currentLoadedLoader = loader;
        ActiveWorkspace = mod?.default || mod;
        isWorkspaceLoading = false;
      }
    };

    try {
      const res = typeof loader === 'function' ? loader() : loader;
      if (res && typeof res.then === 'function') {
        res.then(handleLoaded).catch((err) => {
          if (!cancelled) {
            currentLoadedLoader = null;
            console.error('Failed to load workspace component:', err);
            workspaceLoadError = err;
            isWorkspaceLoading = false;
          }
        });
      } else {
        handleLoaded(res);
      }
    } catch (err) {
      if (!cancelled) {
        currentLoadedLoader = null;
        workspaceLoadError = err;
        isWorkspaceLoading = false;
      }
    }

    return () => { cancelled = true; };
  });

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
    navigate(getWorkspaceRoutePath(ws));
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
            {#each topLevelNavItems as nav (nav.id)}
              <button 
                class="rail-nav-btn {isNavActive(nav, activeTab, appState.route) ? 'active' : ''}" 
                onclick={() => selectWorkspace(nav.id)} 
                title={nav.label} 
                aria-label={nav.label}
                id="rail-nav-{nav.id}"
              >
                <Icon name={nav.icon} />
              </button>
            {/each}

            <!-- Settings icon -->
            <button 
              class="rail-nav-btn {activeTab === 'settings' ? 'active' : ''}" 
              onclick={() => selectWorkspace('settings')}
              title="設定與防禦管理"
              aria-label="設定與防禦管理"
              id="rail-nav-settings"
            >
              <Icon name="settings" />
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
          {#if isWorkspaceLoading}
            <div class="workspace-loading-state glass-panel" role="status" aria-live="polite">
              <div class="workspace-spinner"></div>
              <span class="loading-text">正在載入工作區...</span>
            </div>
          {:else if workspaceLoadError}
            <div class="workspace-error-fallback glass-panel" role="alert">
              <div class="workspace-error-header">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="workspace-error-icon"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <h4>工作區載入失敗</h4>
              </div>
              <p class="workspace-error-message">{workspaceLoadError.message || '無法載入模組，請檢查網路連線或稍後再試。'}</p>
              <div class="workspace-error-actions">
                <button class="btn btn-secondary" onclick={() => location.reload()}>重新載入頁面</button>
                <button class="btn btn-primary" onclick={() => selectWorkspace('agent')}>回到 AI 助理對話</button>
              </div>
            </div>
          {:else if ActiveWorkspace}
            <ActiveWorkspace />
          {/if}
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
  .relaunch-status { display: flex; align-items: center; gap: 10px; color: rgb(var(--accent-amber)); font-weight: 500; }
  .spinner-icon { width: 14px; height: 14px; border: 2px solid rgba(var(--accent-amber), 0.3); border-top-color: rgb(var(--accent-amber)); border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .toast-popup { position: fixed; bottom: 36px; right: 24px; z-index: 9999; padding: 12px 20px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.15); background: rgba(18, 18, 18, 0.85); backdrop-filter: blur(16px); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .toast-body { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; color: var(--text-primary); font-weight: 500; }

  /* Workspace Async Loading & Error Fallback (Issue #264) */
  .workspace-loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 24px; margin: 24px; gap: 16px; min-height: 280px; background: rgba(255, 255, 255, 0.02); border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 12px; }
  .workspace-spinner { width: 32px; height: 32px; border: 3px solid rgba(var(--accent-rgb, 99, 102, 241), 0.2); border-top-color: var(--accent, #6366f1); border-radius: 50%; animation: spin 0.8s linear infinite; }
  .loading-text { font-size: 0.95rem; color: var(--text-secondary, #94a3b8); font-weight: 500; }
  .workspace-error-fallback { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 48px 24px; margin: 24px; gap: 16px; min-height: 280px; border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.04); border-radius: 12px; }
  .workspace-error-header { display: flex; align-items: center; gap: 10px; color: #ef4444; }
  .workspace-error-header h4 { margin: 0; font-size: 1.15rem; font-weight: 600; }
  .workspace-error-icon { color: #ef4444; }
  .workspace-error-message { max-width: 480px; font-size: 0.9rem; color: var(--text-secondary, #94a3b8); line-height: 1.5; margin: 0; }
  .workspace-error-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
</style>
