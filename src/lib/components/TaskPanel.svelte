<script>
  import { 
    appState, 
    switchActiveTask, 
    setTaskPanelCollapsed,
    filterTasksBySkills,
    getCurrentUserEffectiveSkills,
    createTaskAction,
    showToast
  } from '../store.svelte.js';
  import { getDeclaredSkills } from '../workflow/index.js';

  let isCollapsed = $derived(appState.taskPanelCollapsed);

  let isCreateModalOpen = $state(false);
  let newTitle = $state('');
  let newSkillId = $state('vendor.manage_purchase_order');
  let newAssignee = $state('主管');
  let isCreating = $state(false);

  let declaredSkills = $derived(getDeclaredSkills());
  let effectiveSkills = $derived(getCurrentUserEffectiveSkills(appState));
  let availableSkills = $derived.by(() => {
    if (Array.isArray(effectiveSkills) && effectiveSkills.length > 0) {
      const filtered = declaredSkills.filter(s => effectiveSkills.includes(s.id));
      if (filtered.length > 0) return filtered;
    }
    return declaredSkills;
  });

  $effect(() => {
    if (availableSkills.length > 0 && !availableSkills.some(s => s.id === newSkillId)) {
      const poSkill = availableSkills.find(s => s.id === 'vendor.manage_purchase_order');
      newSkillId = poSkill ? poSkill.id : availableSkills[0].id;
    }
  });

  let visibleTasks = $derived(filterTasksBySkills(appState.tasks, effectiveSkills));

  let pendingCount = $derived(
    visibleTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length
  );

  // Group tasks into hierarchy: top-level parents and their children
  let parentTasks = $derived(
    visibleTasks.filter(t => !t.parent_task_id)
  );

  let getChildrenOf = $derived((parentId) => {
    const list = visibleTasks.filter(t => t.parent_task_id === parentId);
    const seen = new Set();
    return list.filter(child => {
      const key = `${child.title}:${child.skill_id || child.skillId || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  // Any orphaned child tasks whose parent is not in parentTasks
  let orphanTasks = $derived.by(() => {
    const list = visibleTasks.filter(t => t.parent_task_id && !visibleTasks.some(p => p.id === t.parent_task_id));
    const seen = new Set();
    return list.filter(orphan => {
      const key = `${orphan.title}:${orphan.skill_id || orphan.skillId || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  function handleSelectTask(taskId) {
    if (appState.activeTaskId === taskId) {
      // Toggle back to main if clicking same active task
      switchActiveTask(null);
    } else {
      switchActiveTask(taskId);
    }
  }

  function formatCompletedTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${mins}`;
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'in_progress':
        return { label: 'IN_PROGRESS', class: 'badge-in-progress' };
      case 'pending':
        return { label: 'PENDING', class: 'badge-pending' };
      case 'done':
        return { label: 'DONE', class: 'badge-done' };
      case 'cancelled':
        return { label: 'CANCELLED', class: 'badge-cancelled' };
      default:
        return { label: status.toUpperCase(), class: 'badge-pending' };
    }
  }

  async function handleCreateTask(e) {
    if (e) e.preventDefault();
    if (!newTitle.trim() || isCreating) return;
    isCreating = true;
    try {
      const selectedSkill = declaredSkills.find(s => s.id === newSkillId);
      const moduleId = selectedSkill ? selectedSkill.domain : 'vendor';
      const created = await createTaskAction(
        newTitle.trim(),
        moduleId,
        newAssignee.trim() || '主管',
        null,
        newSkillId || null
      );
      isCreateModalOpen = false;
      newTitle = '';
      if (created?.id) {
        await switchActiveTask(created.id);
      }
      showToast('任務建立成功！');
    } catch (err) {
      console.error("Failed to create task:", err);
      showToast('建立任務失敗');
    } finally {
      isCreating = false;
    }
  }
</script>

<aside class="task-panel-container {isCollapsed ? 'collapsed' : ''}">
  {#if !isCollapsed}
    <div class="task-panel-header">
      <div class="header-left">
        <svg class="checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 11l3 3L22 4"></path>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
        </svg>
        <span class="panel-title">我的任務</span>
        {#if pendingCount > 0}
          <span class="badge-count">{pendingCount}</span>
        {/if}
      </div>

      <div class="header-right-actions">
        <button 
          class="add-task-btn" 
          onclick={() => isCreateModalOpen = true}
          title="新增任務" 
          aria-label="新增任務"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>新增</span>
        </button>

        <button 
          class="collapse-btn" 
          onclick={() => setTaskPanelCollapsed(true)}
          title="收合任務面板" 
          aria-label="收合任務面板"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="11 17 6 12 11 7"></polyline>
            <polyline points="18 17 13 12 18 7"></polyline>
          </svg>
        </button>
      </div>
    </div>

    <div class="task-list-scroll">
      {#if visibleTasks.length === 0}
        <div class="empty-tasks-box">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>目前尚無任務</p>
        </div>
      {:else}
        {#each parentTasks as parent (parent.id)}
          {@const parentBadge = getStatusBadge(parent.status)}
          {@const children = getChildrenOf(parent.id)}
          <div class="task-group">
            <!-- Parent Task Card -->
            <button 
              type="button" 
              class="task-card parent-card {appState.activeTaskId === parent.id ? 'active' : ''} {parent.status === 'done' ? 'card-done' : ''}"
              onclick={() => handleSelectTask(parent.id)}
            >
              <div class="card-top-row">
                <span class="task-card-title">{parent.title}</span>
                <span class="status-badge {parentBadge.class}">{parentBadge.label}</span>
              </div>
              <div class="card-meta-row">
                <span>父任務 · {parent.assignee || '主管'}</span>
                {#if parent.status === 'done' && parent.completed_at}
                  <span> · {formatCompletedTime(parent.completed_at)} 完成</span>
                {/if}
              </div>
            </button>

            <!-- Subtask Cards -->
            {#if children.length > 0}
              <div class="subtasks-container">
                {#each children as child (child.id)}
                  {@const childBadge = getStatusBadge(child.status)}
                  <button 
                    type="button" 
                    class="task-card child-card {appState.activeTaskId === child.id ? 'active' : ''} {child.status === 'done' ? 'card-done' : ''}"
                    onclick={() => handleSelectTask(child.id)}
                  >
                    <div class="card-top-row">
                      <span class="task-card-title">{child.title}</span>
                      <span class="status-badge {childBadge.class}">{childBadge.label}</span>
                    </div>
                    <div class="card-meta-row">
                      <span>指派給：{child.assignee || '團隊成員'}</span>
                      {#if child.status === 'done' && child.completed_at}
                        <span> · {formatCompletedTime(child.completed_at)} 完成</span>
                      {/if}
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}

        <!-- Orphan Tasks if any -->
        {#each orphanTasks as orphan (orphan.id)}
          {@const orphanBadge = getStatusBadge(orphan.status)}
          <div class="task-group">
            <button 
              type="button" 
              class="task-card child-card {appState.activeTaskId === orphan.id ? 'active' : ''} {orphan.status === 'done' ? 'card-done' : ''}"
              onclick={() => handleSelectTask(orphan.id)}
            >
              <div class="card-top-row">
                <span class="task-card-title">{orphan.title}</span>
                <span class="status-badge {orphanBadge.class}">{orphanBadge.label}</span>
              </div>
              <div class="card-meta-row">
                <span>指派給：{orphan.assignee}</span>
                {#if orphan.status === 'done' && orphan.completed_at}
                  <span> · {formatCompletedTime(orphan.completed_at)} 完成</span>
                {/if}
              </div>
            </button>
          </div>
        {/each}
      {/if}
    </div>
  {:else}
    <div class="collapsed-strip">
      <button 
        class="expand-btn" 
        onclick={() => setTaskPanelCollapsed(false)}
        title="展開任務面板" 
        aria-label="展開任務面板"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="13 17 18 12 13 7"></polyline>
          <polyline points="6 17 11 12 6 7"></polyline>
        </svg>
      </button>

      <div class="collapsed-icon-wrap" onclick={() => setTaskPanelCollapsed(false)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && setTaskPanelCollapsed(false)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 11l3 3L22 4"></path>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
        </svg>
        {#if pendingCount > 0}
          <span class="badge-count small">{pendingCount}</span>
        {/if}
      </div>

      <span class="collapsed-vertical-text">任務面板</span>
    </div>
  {/if}

  {#if isCreateModalOpen}
    <div 
      class="modal-backdrop" 
      role="presentation"
      onclick={() => isCreateModalOpen = false}
    >
      <div 
        class="modal-card" 
        role="dialog" 
        aria-modal="true"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.key === 'Escape' && (isCreateModalOpen = false)}
      >
        <div class="modal-header">
          <h3>新增任務</h3>
          <button type="button" class="close-btn" onclick={() => isCreateModalOpen = false}>✕</button>
        </div>
        <form onsubmit={handleCreateTask} class="modal-body">
          <div class="form-field">
            <label for="task-title-input">任務名稱</label>
            <input 
              id="task-title-input"
              type="text" 
              bind:value={newTitle} 
              placeholder="例如：向大同採購辦公設備" 
              required
            />
          </div>
          <div class="form-field">
            <label for="task-skill-select">任務類型 / 技能</label>
            <select id="task-skill-select" bind:value={newSkillId}>
              {#each availableSkills as skill}
                <option value={skill.id}>{skill.name} ({skill.domain})</option>
              {/each}
            </select>
          </div>
          <div class="form-field">
            <label for="task-assignee-input">指派對象</label>
            <input 
              id="task-assignee-input"
              type="text" 
              bind:value={newAssignee} 
              placeholder="指派人"
            />
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-cancel" onclick={() => isCreateModalOpen = false}>取消</button>
            <button type="submit" class="btn-primary" disabled={isCreating || !newTitle.trim()}>
              {isCreating ? '建立中...' : '確認建立'}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</aside>

<style>
  .task-panel-container {
    width: 250px;
    height: 100vh;
    background: #15161E;
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  }

  .task-panel-container.collapsed {
    width: 44px;
  }

  .task-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-color);
    height: 44px;
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .checklist-icon {
    color: var(--text-secondary);
  }

  .panel-title {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.2px;
  }

  .badge-count {
    background: rgb(var(--accent-amber));
    color: #0F0F12;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 9999px;
    line-height: 1.3;
  }

  .badge-count.small {
    position: absolute;
    top: -4px;
    right: -4px;
    padding: 0 4px;
    font-size: 0.65rem;
  }

  .collapse-btn, .expand-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all var(--transition-fast);
  }

  .collapse-btn:hover, .expand-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.08);
  }

  .task-list-scroll {
    flex-grow: 1;
    overflow-y: auto;
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .task-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .subtasks-container {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-left: 10px;
    border-left: 2px solid rgba(255, 255, 255, 0.06);
    margin-left: 6px;
    margin-top: 2px;
  }

  .task-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    text-align: left;
    cursor: pointer;
    transition: all var(--transition-fast);
    width: 100%;
  }

  .task-card:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(var(--accent-rgb), 0.3);
    transform: translateY(-1px);
  }

  .task-card.active {
    background: rgba(var(--accent-rgb), 0.08);
    border-color: var(--accent);
    box-shadow: 0 0 12px rgba(var(--accent-rgb), 0.15);
  }

  .task-card.card-done {
    opacity: 0.65;
  }

  .card-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .task-card-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-meta-row {
    font-size: 0.73rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-badge {
    font-size: 0.68rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    flex-shrink: 0;
  }

  .badge-in-progress {
    background: rgba(34, 211, 238, 0.15);
    color: rgb(34, 211, 238);
    border: 1px solid rgba(34, 211, 238, 0.3);
  }

  .badge-pending {
    background: rgba(245, 158, 11, 0.15);
    color: rgb(245, 158, 11);
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .badge-done {
    background: rgba(16, 185, 129, 0.15);
    color: rgb(16, 185, 129);
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .badge-cancelled {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-muted);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .empty-tasks-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 30px 10px;
    color: var(--text-muted);
    gap: 8px;
    font-size: 0.85rem;
  }

  /* Collapsed minimal strip */
  .collapsed-strip {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 4px;
    gap: 16px;
    height: 100%;
  }

  .collapsed-icon-wrap {
    position: relative;
    cursor: pointer;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    transition: all var(--transition-fast);
  }

  .collapsed-icon-wrap:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }

  .collapsed-vertical-text {
    writing-mode: vertical-lr;
    text-orientation: mixed;
    font-size: 0.78rem;
    color: var(--text-muted);
    letter-spacing: 2px;
    margin-top: 10px;
  }

  .header-right-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .add-task-btn {
    background: rgba(var(--accent-cyan), 0.15);
    border: 1px solid rgba(var(--accent-cyan), 0.3);
    color: rgb(var(--accent-cyan));
    font-size: 0.75rem;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: all var(--transition-fast);
  }

  .add-task-btn:hover {
    background: rgba(var(--accent-cyan), 0.25);
    color: #fff;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    width: 90%;
    max-width: 440px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1rem;
    color: var(--text-primary);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1.1rem;
    cursor: pointer;
  }

  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-field label {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .form-field input, .form-field select {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 0.88rem;
  }

  .form-field input:focus, .form-field select:focus {
    outline: none;
    border-color: rgb(var(--accent-cyan));
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 10px;
  }

  .btn-cancel {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-primary {
    background: rgb(var(--accent-cyan));
    color: #0F0F12;
    font-weight: 600;
    border: none;
    padding: 6px 16px;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
