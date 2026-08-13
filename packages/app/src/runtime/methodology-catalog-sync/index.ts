import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { MethodologyDescriptor } from "@getpaseo/protocol/team/v2-rpc-schemas";
import type { DirectorySourceToken } from "@/runtime/directory-sync/transaction";

export type MethodologyCatalogStatus =
  | "checking_host"
  | "connecting"
  | "loading"
  | "ready"
  | "failed"
  | "update_host";
export interface MethodologyCatalogReplica {
  status: MethodologyCatalogStatus;
  methodologies: readonly MethodologyDescriptor[];
  error: string | null;
}
export interface MethodologyCatalogConnection {
  client: DaemonClient | null;
  status: "online" | "offline";
  source: DirectorySourceToken;
  supported: boolean | null;
}

const initial = (): MethodologyCatalogReplica => ({
  status: "checking_host",
  methodologies: [],
  error: null,
});

export class MethodologyCatalogSync {
  private connection: MethodologyCatalogConnection = {
    client: null,
    status: "offline",
    source: { clientGeneration: 0, connectionEpoch: 0 },
    supported: null,
  };
  private replica = initial();
  private request = 0;
  constructor(private readonly commit: (replica: MethodologyCatalogReplica) => void) {}

  connectionChanged(connection: MethodologyCatalogConnection): void {
    if (
      this.connection.client === connection.client &&
      this.connection.status === connection.status &&
      this.connection.supported === connection.supported &&
      this.connection.source.clientGeneration === connection.source.clientGeneration &&
      this.connection.source.connectionEpoch === connection.source.connectionEpoch
    ) {
      return;
    }
    this.connection = connection;
    this.request += 1;
    if (connection.supported === null) return this.update("checking_host");
    if (connection.supported === false) return this.update("update_host", [], null);
    if (!connection.client || connection.status !== "online") return this.update("connecting");
    void this.hydrate(connection.client, this.request);
  }
  refresh(): void {
    const { client, status, supported } = this.connection;
    if (client && status === "online" && supported === true)
      void this.hydrate(client, ++this.request);
  }
  dispose(): void {
    this.request += 1;
  }
  private update(
    status: MethodologyCatalogStatus,
    methodologies = this.replica.methodologies,
    error: string | null = this.replica.error,
  ): void {
    this.replica = { status, methodologies, error };
    this.commit(this.replica);
  }
  private async hydrate(client: DaemonClient, request: number): Promise<void> {
    this.update("loading", this.replica.methodologies, null);
    try {
      const payload = await client.listTeamMethodologies();
      if (payload.error) throw new Error(payload.error);
      if (request !== this.request) return;
      this.update("ready", payload.methodologies, null);
    } catch (error) {
      if (request !== this.request) return;
      this.update(
        "failed",
        this.replica.methodologies,
        error instanceof Error ? error.message : "Methodology catalog could not be read.",
      );
    }
  }
}
