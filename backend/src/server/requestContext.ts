import { AsyncLocalStorage } from "node:async_hooks"

type RequestContext = {
  isGncRequest?: boolean
  workspaceRootOverride?: string
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>()

export function runWithRequestContext<T>(context: RequestContext, callback: () => T) {
  return requestContextStorage.run(context, callback)
}

export function enterRequestContext(context: RequestContext) {
  requestContextStorage.enterWith(context)
}

export function getRequestWorkspaceRootOverride() {
  return requestContextStorage.getStore()?.workspaceRootOverride ?? null
}

export function isGncRequestContext() {
  return requestContextStorage.getStore()?.isGncRequest === true
}
