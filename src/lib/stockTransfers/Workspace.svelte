<script>
  import WarehouseWorkspace from '../warehouses/Workspace.svelte';
  let props = $props();
</script>

<WarehouseWorkspace initialSubTab="transfers" {...props} />

