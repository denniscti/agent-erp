<script>
  import WarehouseWorkspace from '../warehouses/Workspace.svelte';
  let props = $props();
</script>

<WarehouseWorkspace initialSubTab="adjustments" {...props} />

