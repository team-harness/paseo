import { describe, expect, it } from "vitest";
import { filterHostsByHostFilters } from "./host-filter";

const hosts = [{ serverId: "host-a" }, { serverId: "host-b" }];

describe("filterHostsByHostFilters", () => {
  it("returns all hosts when no filter is active", () => {
    expect(filterHostsByHostFilters(hosts, [], true)).toEqual(hosts);
  });

  it("keeps only selected hosts", () => {
    expect(filterHostsByHostFilters(hosts, ["host-b"], true)).toEqual([{ serverId: "host-b" }]);
  });

  it("falls back to all hosts when a settled registry has no matches", () => {
    expect(filterHostsByHostFilters(hosts, ["removed-host"], true)).toEqual(hosts);
  });

  it("waits for registry reconciliation before falling back", () => {
    expect(filterHostsByHostFilters(hosts, ["pending-host"], false)).toEqual([]);
  });
});
