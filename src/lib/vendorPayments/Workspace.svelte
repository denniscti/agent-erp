<script>
  import AccountsPayableWorkspace from '../accountsPayable/Workspace.svelte';
  let props = $props();
</script>

<AccountsPayableWorkspace initialSubTab="vendor-payments" {...props} />

