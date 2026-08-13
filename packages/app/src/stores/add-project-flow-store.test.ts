import { beforeEach, describe, expect, it } from "vitest";
import { useAddProjectFlowStore } from "./add-project-flow-store";

describe("add project flow success route", () => {
  beforeEach(() => useAddProjectFlowStore.setState({ request: null }));

  it("keeps a typed success intent on the request and clears it on close", () => {
    useAddProjectFlowStore.getState().open("host-a", { kind: "host_teams", serverId: "host-a" });
    expect(useAddProjectFlowStore.getState().request).toMatchObject({
      preferredHostId: "host-a",
      successIntent: { kind: "host_teams", serverId: "host-a" },
    });
    useAddProjectFlowStore.getState().close();
    expect(useAddProjectFlowStore.getState().request).toBeNull();
  });
});
