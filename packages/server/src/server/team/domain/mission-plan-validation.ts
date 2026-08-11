import type { MissionMutableScope, MissionWorkstream } from "@getpaseo/protocol/team/v2-types";

export type MissionPlanIssue =
  | { kind: "dependency_cycle"; workstreamIds: string[] }
  | { kind: "duplicate_workstream_id"; workstreamId: string }
  | {
      kind: "invalid_mutable_path_prefix";
      workstreamId: string;
      pathPrefix: string;
    }
  | {
      kind: "unknown_dependency";
      workstreamId: string;
      dependencyWorkstreamId: string;
    }
  | {
      kind: "mutable_scope_conflict";
      workstreamIds: [string, string];
      pathPrefixes: [string, string];
    };

export type MissionPlanValidation = { ok: true } | { ok: false; issues: MissionPlanIssue[] };

function findDuplicateWorkstreamIds(
  workstreams: ReadonlyArray<MissionWorkstream>,
): MissionPlanIssue[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const issues: MissionPlanIssue[] = [];
  for (const workstream of workstreams) {
    if (!seen.has(workstream.workstreamId)) {
      seen.add(workstream.workstreamId);
      continue;
    }
    if (reported.has(workstream.workstreamId)) continue;
    reported.add(workstream.workstreamId);
    issues.push({ kind: "duplicate_workstream_id", workstreamId: workstream.workstreamId });
  }
  return issues;
}

export function isNormalizedWorkspacePathPrefix(pathPrefix: string): boolean {
  const isAbsolute = pathPrefix.startsWith("/") || /^[A-Za-z]:/.test(pathPrefix);
  const hasGlobSyntax = ["*", "?", "[", "]", "{", "}"].some((character) =>
    pathPrefix.includes(character),
  );
  if (isAbsolute || hasGlobSyntax || pathPrefix.includes("\\") || pathPrefix.includes("\0")) {
    return false;
  }
  const segments = pathPrefix.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function isNormalizedWorkspaceFilePath(path: string): boolean {
  const isAbsolute = path.startsWith("/") || /^[A-Za-z]:/.test(path);
  if (isAbsolute || path.includes("\\") || path.includes("\0")) return false;
  const segments = path.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function pathPrefixContains(parent: string, child: string): boolean {
  return parent === child || child.startsWith(`${parent}/`);
}

export function isMutableScopeContainedBy(
  child: MissionMutableScope,
  parent: MissionMutableScope,
): boolean {
  if (child.kind === "read_only" || parent.kind === "workspace") return true;
  if (parent.kind === "read_only" || child.kind === "workspace") return false;
  return child.pathPrefixes.every((childPrefix) =>
    parent.pathPrefixes.some((parentPrefix) => pathPrefixContains(parentPrefix, childPrefix)),
  );
}

function findInvalidMutablePathPrefixes(
  workstreams: ReadonlyArray<MissionWorkstream>,
): MissionPlanIssue[] {
  const issues: MissionPlanIssue[] = [];
  for (const workstream of workstreams) {
    if (workstream.mutableScope.kind !== "paths") continue;
    for (const pathPrefix of workstream.mutableScope.pathPrefixes) {
      if (isNormalizedWorkspacePathPrefix(pathPrefix)) continue;
      issues.push({
        kind: "invalid_mutable_path_prefix",
        workstreamId: workstream.workstreamId,
        pathPrefix,
      });
    }
  }
  return issues;
}

function findUnknownDependencies(
  workstreams: ReadonlyArray<MissionWorkstream>,
): MissionPlanIssue[] {
  const workstreamIds = new Set(workstreams.map((workstream) => workstream.workstreamId));
  const issues: MissionPlanIssue[] = [];
  for (const workstream of workstreams) {
    for (const dependencyWorkstreamId of workstream.dependencyWorkstreamIds) {
      if (workstreamIds.has(dependencyWorkstreamId)) continue;
      issues.push({
        kind: "unknown_dependency",
        workstreamId: workstream.workstreamId,
        dependencyWorkstreamId,
      });
    }
  }
  return issues;
}

function findDependencyCycle(workstreams: ReadonlyArray<MissionWorkstream>): string[] | null {
  const byId = new Map(workstreams.map((workstream) => [workstream.workstreamId, workstream]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  function visit(workstreamId: string): string[] | null {
    const cycleStart = path.indexOf(workstreamId);
    if (cycleStart >= 0) return path.slice(cycleStart);
    if (visited.has(workstreamId) || visiting.has(workstreamId)) return null;

    const workstream = byId.get(workstreamId);
    if (!workstream) return null;
    visiting.add(workstreamId);
    path.push(workstreamId);
    for (const dependencyId of workstream.dependencyWorkstreamIds) {
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(workstreamId);
    visited.add(workstreamId);
    return null;
  }

  for (const workstream of workstreams) {
    const cycle = visit(workstream.workstreamId);
    if (cycle) return cycle;
  }
  return null;
}

function mutablePathPrefixes(scope: MissionMutableScope): string[] {
  if (scope.kind === "read_only") return [];
  if (scope.kind === "workspace") return ["."];
  return scope.pathPrefixes;
}

function pathPrefixesOverlap(left: string, right: string): boolean {
  if (left === "." || right === ".") return true;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function dependsOn(
  workstreamId: string,
  dependencyId: string,
  byId: ReadonlyMap<string, MissionWorkstream>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(workstreamId)) return false;
  visited.add(workstreamId);
  const workstream = byId.get(workstreamId);
  if (!workstream) return false;
  if (workstream.dependencyWorkstreamIds.includes(dependencyId)) return true;
  return workstream.dependencyWorkstreamIds.some((candidateId) =>
    dependsOn(candidateId, dependencyId, byId, visited),
  );
}

function findScopeConflicts(workstreams: ReadonlyArray<MissionWorkstream>): MissionPlanIssue[] {
  const issues: MissionPlanIssue[] = [];
  const byId = new Map(workstreams.map((workstream) => [workstream.workstreamId, workstream]));
  for (let leftIndex = 0; leftIndex < workstreams.length; leftIndex += 1) {
    const left = workstreams[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < workstreams.length; rightIndex += 1) {
      const right = workstreams[rightIndex];
      if (!right) continue;
      const isSerialized =
        dependsOn(left.workstreamId, right.workstreamId, byId) ||
        dependsOn(right.workstreamId, left.workstreamId, byId);
      if (isSerialized) continue;
      for (const leftPrefix of mutablePathPrefixes(left.mutableScope)) {
        const rightPrefix = mutablePathPrefixes(right.mutableScope).find((candidate) =>
          pathPrefixesOverlap(leftPrefix, candidate),
        );
        if (!rightPrefix) continue;
        issues.push({
          kind: "mutable_scope_conflict",
          workstreamIds: [left.workstreamId, right.workstreamId],
          pathPrefixes: [leftPrefix, rightPrefix],
        });
        break;
      }
    }
  }
  return issues;
}

export function validateMissionWorkstreams(
  workstreams: ReadonlyArray<MissionWorkstream>,
): MissionPlanValidation {
  const duplicateIds = findDuplicateWorkstreamIds(workstreams);
  if (duplicateIds.length > 0) {
    return { ok: false, issues: duplicateIds };
  }
  const invalidPathPrefixes = findInvalidMutablePathPrefixes(workstreams);
  if (invalidPathPrefixes.length > 0) {
    return { ok: false, issues: invalidPathPrefixes };
  }
  const unknownDependencies = findUnknownDependencies(workstreams);
  if (unknownDependencies.length > 0) {
    return { ok: false, issues: unknownDependencies };
  }
  const cycle = findDependencyCycle(workstreams);
  if (cycle) {
    return { ok: false, issues: [{ kind: "dependency_cycle", workstreamIds: cycle }] };
  }
  const scopeConflicts = findScopeConflicts(workstreams);
  return scopeConflicts.length > 0 ? { ok: false, issues: scopeConflicts } : { ok: true };
}
