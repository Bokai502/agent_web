import type { FlowDocument } from './types';

export type SaveStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error';

export type FlowWorkspaceRef = {
  versionId?: string | null;
  workspaceDir?: string | null;
  workspaceId?: string | null;
};

export async function fetchRemoteFlow(endpoint: string): Promise<unknown | null> {
  const response = await fetch(endpoint, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Load failed: ${response.status}`);
  }

  const payload = (await response.json()) as { flow: unknown | null };
  return payload.flow;
}

export async function saveRemoteFlow(endpoint: string, flow: FlowDocument, workspace: FlowWorkspaceRef): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payload: flow,
      versionId: workspace.versionId,
      workspaceDir: workspace.workspaceDir,
      workspaceId: workspace.workspaceId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Save failed: ${response.status}`);
  }
}
