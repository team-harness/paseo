export function filterHostsByHostFilters<T extends { serverId: string }>(
  hosts: readonly T[],
  hostFilters: readonly string[],
  hostRegistryLoaded: boolean,
): T[] {
  if (hostFilters.length === 0) {
    return [...hosts];
  }

  const selected = new Set(hostFilters);
  const filtered = hosts.filter((host) => selected.has(host.serverId));
  return hostRegistryLoaded && filtered.length === 0 ? [...hosts] : filtered;
}
