export interface TeamOperationPermit {
  readonly teamId: string;
}

export class TeamOperationCoordinator {
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly activePermits = new WeakSet<TeamOperationPermit>();

  async serialize<T>(
    teamId: string,
    operation: (permit: TeamOperationPermit) => Promise<T>,
    permit?: TeamOperationPermit,
  ): Promise<T> {
    if (permit?.teamId === teamId && this.activePermits.has(permit)) {
      return operation(permit);
    }

    const previous = this.operations.get(teamId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const nextPermit: TeamOperationPermit = { teamId };
        this.activePermits.add(nextPermit);
        try {
          return await operation(nextPermit);
        } finally {
          this.activePermits.delete(nextPermit);
        }
      });
    this.operations.set(teamId, next);
    try {
      return await next;
    } finally {
      if (this.operations.get(teamId) === next) this.operations.delete(teamId);
    }
  }
}
