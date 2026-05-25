import path from "path"

export function isPathInside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}
