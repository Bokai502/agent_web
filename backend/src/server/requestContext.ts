import { AsyncLocalStorage } from "node:async_hooks"

type RequestContext = {
  isGncRequest?: boolean
  userId?: string
  userWorkspaceRoot?: string
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

export function getRequestUserId() {
  return requestContextStorage.getStore()?.userId ?? null
}

export function getRequestUserWorkspaceRoot() {
  return requestContextStorage.getStore()?.userWorkspaceRoot ?? null
}

export function isGncRequestContext() {
  return requestContextStorage.getStore()?.isGncRequest === true
}
