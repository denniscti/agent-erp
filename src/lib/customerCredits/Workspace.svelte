<script>
  import { onMount } from 'svelte';
  import {
    appState,
    fetchPartners,
    updatePartnerAction,
    showToast,
    formatCurrency
  } from '../store.svelte.js';
  import { getCollectionTermsNotice } from '../terms.js';
  import { fetchUninvoicedSalesOrders } from '../customerInvoices/store.js';

  let selectedCustomerId = $state('');
  let searchTerm = $state('');
  let isSaving = $state(false);
  let formError = $state('');

  let customerUninvoiced = $derived.by(() => {
    if (!selectedCustomerId) return { sumA: 0, sumB: 0, sumC: 0, total: 0, count: 0 };
    const list = (appState.uninvoicedSalesOrders || []).filter(o => o.customer_partner_id === selectedCustomerId);
    const sumA = list.filter(o => o.group === 'per_order_confirmed').reduce((s, o) => s + (o.uninvoiced_amount || 0), 0);
    const sumB = list.filter(o => o.group === 'per_order_shipped').reduce((s, o) => s + (o.uninvoiced_amount || 0), 0);
    const sumC = list.filter(o => o.group === 'monthly_consolidated').reduce((s, o) => s + (o.uninvoiced_amount || 0), 0);
    return {
      sumA: Math.round(sumA * 100) / 100,
      sumB: Math.round(sumB * 100) / 100,
      sumC: Math.round(sumC * 100) / 100,
      total: Math.round((sumA + sumB + sumC) * 100) / 100,
      count: list.length
    };
  });

  // Form states for selected customer
  let collectionTermsType = $state('');
  let collectionTermsDays = $state(0);
  let invoiceIssuanceMode = $state('per_order');
  let clearRequestedNote = $state(false);

  let customers = $derived(
    (appState.partners || []).filter(p => p.is_customer)
  );

  let filteredCustomers = $derived(
    customers.filter(c => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        (c.name && c.name.toLowerCase().includes(term)) ||
        (c.tax_id && c.tax_id.includes(term)) ||
        (c.id && c.id.toLowerCase().includes(term))
      );
    })
  );

  let selectedCustomer = $derived(
    customers.find(c => c.id === selectedCustomerId) || null
  );

  // Sync form when selected customer changes
  $effect(() => {
    if (selectedCustomer) {
      collectionTermsType = selectedCustomer.collection_terms_type || '';
      collectionTermsDays = selectedCustomer.collection_terms_days !== null && selectedCustomer.collection_terms_days !== undefined
        ? selectedCustomer.collection_terms_days
        : 0;
      invoiceIssuanceMode = selectedCustomer.invoice_issuance_mode || 'per_order';
      clearRequestedNote = false;
      formError = '';
    }
  });

  onMount(async () => {
    if (!appState.partners || appState.partners.length === 0) {
      await fetchPartners();
    }
    await fetchUninvoicedSalesOrders();
    if (customers.length > 0 && !selectedCustomerId) {
      selectedCustomerId = customers[0].id;
    }
  });

  async function handleSaveTerms(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!selectedCustomer) return;

    formError = '';

    const payload = {
      id: selectedCustomer.id,
      invoice_issuance_mode: invoiceIssuanceMode
    };

    if (!collectionTermsType) {
      payload.clear_collection_terms = true;
    } else {
      const days = Number(collectionTermsDays);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        formError = '收款天數需為 0～365 的整數';
        return;
      }
      payload.collection_terms_type = collectionTermsType;
      payload.collection_terms_days = days;
    }

    if (clearRequestedNote) {
      payload.clear_requested_collection_terms_note = true;
    }

    isSaving = true;
    try {
      await updatePartnerAction(payload);
      showToast(`已成功更新「${selectedCustomer.name}」的收款條件與信用設定！`);
    } catch (err) {
      formError = err?.message || '儲存收款條件失敗';
    } finally {
      isSaving = false;
    }
  }
</script>

<div class="customer-credits-workspace">
  <!-- Header Banner -->
  <div class="workspace-header glass-panel">
    <div class="header-left">
      <div class="header-tag">M14 應收帳款管理</div>
      <h2 class="workspace-title">客戶信用與收款條件管理</h2>
      <p class="workspace-desc">
        財務專屬信用審閱畫面：設定正式收款條件與開票模式，審閱業務提出之申請備註。資訊架構獨立於 M5 客戶個資。
      </p>
    </div>
  </div>

  <div class="workspace-content-grid">
    <!-- Left Column: Customer Selector -->
    <div class="customer-list-panel glass-panel">
      <div class="panel-header">
        <h3 class="panel-title">客戶清單 ({filteredCustomers.length})</h3>
        <input
          type="text"
          class="form-input search-input"
          placeholder="搜尋客戶名稱／統編／ID..."
          bind:value={searchTerm}
        />
      </div>

      <div class="customer-items-scroll">
        {#if filteredCustomers.length === 0}
          <div class="empty-state">尚無符合的客戶資料</div>
        {:else}
          {#each filteredCustomers as customer (customer.id)}
            <button
              type="button"
              class="customer-row-btn {selectedCustomerId === customer.id ? 'active' : ''}"
              onclick={() => selectedCustomerId = customer.id}
            >
              <div class="customer-row-main">
                <span class="customer-row-name">{customer.name}</span>
                {#if customer.requested_collection_terms_note}
                  <span class="badge badge-amber badge-mini">有申請備註</span>
                {/if}
              </div>
              <div class="customer-row-sub">
                <span>{customer.tax_id ? `統編：${customer.tax_id}` : customer.id}</span>
                {#if customer.collection_terms_type}
                  <span class="terms-pill active">
                    {customer.collection_terms_type === 'net' ? '出貨 ' : '月結 '}{customer.collection_terms_days} 天
                  </span>
                {:else}
                  <span class="terms-pill unconfigured">未設定</span>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Right Column: Customer Details & Credit Settings -->
    <div class="credit-detail-panel glass-panel">
      {#if !selectedCustomer}
        <div class="empty-detail-state">
          <p>請從左側選取欲檢視或設定收款條件的客戶</p>
        </div>
      {:else}
        <!-- Customer Info Summary -->
        <div class="customer-summary-card">
          <div class="summary-meta">
            <span class="badge badge-cyan">客戶檔案</span>
            <h3>{selectedCustomer.name}</h3>
            <div class="meta-row">
              <span>客戶編號：<code>{selectedCustomer.id}</code></span>
              <span>統一編號：{selectedCustomer.tax_id || '未填寫'}</span>
              <span>雙重身份：{selectedCustomer.is_vendor ? '是 (兼供應商)' : '純客戶'}</span>
            </div>
          </div>

          <!-- Transaction & Aging Summary -->
          <div class="aging-summary-chips">
            <div class="chip">
              <span class="chip-label">往來狀態</span>
              <span class="chip-val status-ok">正常交易中</span>
            </div>
            <div class="chip">
              <span class="chip-label">信用評等</span>
              <span class="chip-val">優良 (標準)</span>
            </div>
            <div class="chip">
              <span class="chip-label">帳齡摘要</span>
              <span class="chip-val">無逾期應收帳款</span>
            </div>
          </div>

          <!-- Uninvoiced Amount Summary (CI-226) -->
          <div class="uninvoiced-section">
            <h4 class="section-title">未開票金額（uninvoiced_amount）分組摘要</h4>
            <div class="aging-summary-chips">
              <div class="chip">
                <span class="chip-label">(a) 逐單已確認未開票</span>
                <span class="chip-val font-mono">{formatCurrency(customerUninvoiced.sumA)}</span>
              </div>
              <div class="chip">
                <span class="chip-label">(b) 逐單已出貨未開票</span>
                <span class="chip-val font-mono text-warning">{formatCurrency(customerUninvoiced.sumB)}</span>
              </div>
              <div class="chip">
                <span class="chip-label">(c) 月結本月待彙開</span>
                <span class="chip-val font-mono text-primary">{formatCurrency(customerUninvoiced.sumC)}</span>
              </div>
              <div class="chip">
                <span class="chip-label">未開票總額</span>
                <span class="chip-val font-mono font-bold">{formatCurrency(customerUninvoiced.total)}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Business Note Alert (Requested Collection Terms Note) -->
        <div class="note-section">
          <h4 class="section-title">業務申請備註（業務端提出）</h4>
          {#if selectedCustomer.requested_collection_terms_note}
            <div class="note-alert-box">
              <div class="note-header">
                <span class="note-badge">⚠️ 待處理申請</span>
                <span class="note-time">業務於 M5 客戶詳細頁填寫留下</span>
              </div>
              <p class="note-content">
                「{selectedCustomer.requested_collection_terms_note}」
              </p>
              <label class="clear-note-checkbox">
                <input type="checkbox" bind:checked={clearRequestedNote} />
                <span>財務設定正式條件後，同時清空此申請備註</span>
              </label>
            </div>
          {:else}
            <div class="no-note-box">
              <span class="info-icon">ℹ️</span>
              <span>此客戶目前無業務提出的收款條件申請備註。</span>
            </div>
          {/if}
        </div>

        <!-- Formal Collection Terms Configuration Form -->
        <form onsubmit={handleSaveTerms} class="terms-form">
          <h4 class="section-title">正式生效收款條件與開票模式</h4>

          {#if !selectedCustomer.collection_terms_type}
            <div class="terms-notice-bar unconfigured">
              ⚠️ {getCollectionTermsNotice(selectedCustomer.collection_terms_type)}，目前推算到期日將以立帳單據日為準
            </div>
          {:else}
            <div class="terms-notice-bar configured">
              ✓ 目前正式收款條件：{selectedCustomer.collection_terms_type === 'net' ? '出貨/立帳後 N 天' : '月結後 N 天'}（{selectedCustomer.collection_terms_days} 天），開票模式：{selectedCustomer.invoice_issuance_mode === 'monthly_consolidated' ? '月結彙開' : '逐單開立'}
            </div>
          {/if}

          <div class="form-grid">
            <div class="form-group">
              <label for="collection-terms-type-select">收款條件類型</label>
              <select
                id="collection-terms-type-select"
                class="form-input"
                bind:value={collectionTermsType}
              >
                <option value="">未設定收款條件（清空）</option>
                <option value="net">貨到／出貨後 N 天 (net)</option>
                <option value="month_end">月結後 N 天 (month_end)</option>
              </select>
            </div>

            {#if collectionTermsType}
              <div class="form-group">
                <label for="collection-terms-days-input">天數（0～365 天）</label>
                <input
                  id="collection-terms-days-input"
                  type="number"
                  min="0"
                  max="365"
                  class="form-input"
                  placeholder="請輸入天數"
                  bind:value={collectionTermsDays}
                />
              </div>
            {/if}

            <div class="form-group">
              <label for="invoice-issuance-mode-select">開票模式 (Invoice Mode)</label>
              <select
                id="invoice-issuance-mode-select"
                class="form-input"
                bind:value={invoiceIssuanceMode}
              >
                <option value="per_order">per_order (逐單開立，含隨貨)</option>
                <option value="monthly_consolidated">monthly_consolidated (月結彙開)</option>
              </select>
            </div>
          </div>

          {#if formError}
            <div class="form-error-msg">⚠️ {formError}</div>
          {/if}

          <div class="form-actions">
            <button
              type="submit"
              class="btn btn-primary"
              disabled={isSaving}
            >
              {isSaving ? '儲存中...' : '儲存正式條件設定'}
            </button>
          </div>
        </form>
      {/if}
    </div>
  </div>
</div>

<style>
  .customer-credits-workspace {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    height: 100%;
    overflow-y: auto;
  }

  .workspace-header {
    padding: 20px 24px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: rgba(255, 255, 255, 0.02);
  }

  .header-tag {
    font-size: 0.75rem;
    color: var(--accent-cyan);
    font-weight: 600;
    margin-bottom: 4px;
    letter-spacing: 0.5px;
  }

  .workspace-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 6px 0;
  }

  .workspace-desc {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.4;
  }

  .workspace-content-grid {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 16px;
    min-height: 520px;
  }

  .customer-list-panel {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
    overflow: hidden;
  }

  .panel-header {
    padding: 14px;
    border-bottom: 1px solid var(--border-color);
  }

  .panel-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 10px 0;
  }

  .search-input {
    width: 100%;
    padding: 6px 10px;
    font-size: 0.8rem;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .customer-items-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .customer-row-btn {
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .customer-row-btn:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .customer-row-btn.active {
    background: rgba(0, 240, 255, 0.08);
    border-color: rgba(0, 240, 255, 0.3);
  }

  .customer-row-main {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .customer-row-name {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .customer-row-sub {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .terms-pill {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.68rem;
  }

  .terms-pill.active {
    background: rgba(0, 240, 255, 0.12);
    color: var(--accent-cyan);
    border: 1px solid rgba(0, 240, 255, 0.25);
  }

  .terms-pill.unconfigured {
    background: rgba(245, 158, 11, 0.1);
    color: #fbbf24;
    border: 1px dashed rgba(245, 158, 11, 0.3);
  }

  .badge-mini {
    font-size: 0.65rem;
    padding: 1px 6px;
    border-radius: 4px;
  }

  .credit-detail-panel {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 20px;
    background: rgba(255, 255, 255, 0.02);
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .empty-detail-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .customer-summary-card {
    padding: 16px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }

  .summary-meta h3 {
    margin: 6px 0 8px 0;
    font-size: 1.15rem;
    color: var(--text-primary);
  }

  .meta-row {
    display: flex;
    gap: 14px;
    font-size: 0.78rem;
    color: var(--text-muted);
    flex-wrap: wrap;
  }

  .meta-row code {
    color: var(--accent-cyan);
  }

  .aging-summary-chips {
    display: flex;
    gap: 10px;
  }

  .chip {
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .chip-label {
    font-size: 0.68rem;
    color: var(--text-muted);
  }

  .chip-val {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .chip-val.status-ok {
    color: #4ade80;
  }

  .section-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 10px 0;
  }

  .note-alert-box {
    padding: 14px;
    border-radius: 6px;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.3);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .note-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .note-badge {
    font-size: 0.75rem;
    font-weight: 600;
    color: #fbbf24;
  }

  .note-time {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .note-content {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-primary);
    line-height: 1.5;
  }

  .clear-note-checkbox {
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.78rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .no-note-box {
    padding: 12px 14px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px dashed var(--border-color);
    font-size: 0.82rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .terms-notice-bar {
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 0.82rem;
    margin-bottom: 14px;
  }

  .terms-notice-bar.unconfigured {
    background: rgba(245, 158, 11, 0.1);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .terms-notice-bar.configured {
    background: rgba(0, 240, 255, 0.08);
    color: var(--accent-cyan);
    border: 1px solid rgba(0, 240, 255, 0.25);
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
    margin-bottom: 16px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-group label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .form-error-msg {
    font-size: 0.8rem;
    color: var(--status-error);
    margin-bottom: 10px;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>

