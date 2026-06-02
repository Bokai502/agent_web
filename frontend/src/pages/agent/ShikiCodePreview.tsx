import { useEffect, useMemo, useState } from 'react'
import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageInput,
  type SpecialLanguage,
  type ThemeInput,
} from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import langBash from 'shiki/langs/bash.mjs'
import langC from 'shiki/langs/c.mjs'
import langCpp from 'shiki/langs/cpp.mjs'
import langCsharp from 'shiki/langs/csharp.mjs'
import langCss from 'shiki/langs/css.mjs'
import langCsv from 'shiki/langs/csv.mjs'
import langHtml from 'shiki/langs/html.mjs'
import langJava from 'shiki/langs/java.mjs'
import langJavascript from 'shiki/langs/javascript.mjs'
import langJson from 'shiki/langs/json.mjs'
import langJsonc from 'shiki/langs/jsonc.mjs'
import langJsx from 'shiki/langs/jsx.mjs'
import langLess from 'shiki/langs/less.mjs'
import langMarkdown from 'shiki/langs/markdown.mjs'
import langPhp from 'shiki/langs/php.mjs'
import langPython from 'shiki/langs/python.mjs'
import langR from 'shiki/langs/r.mjs'
import langSass from 'shiki/langs/sass.mjs'
import langScss from 'shiki/langs/scss.mjs'
import langShellscript from 'shiki/langs/shellscript.mjs'
import langSql from 'shiki/langs/sql.mjs'
import langTsx from 'shiki/langs/tsx.mjs'
import langTypescript from 'shiki/langs/typescript.mjs'
import langVue from 'shiki/langs/vue.mjs'
import langXml from 'shiki/langs/xml.mjs'
import langYaml from 'shiki/langs/yaml.mjs'
import langZsh from 'shiki/langs/zsh.mjs'
import githubDarkDimmed from 'shiki/themes/github-dark-dimmed.mjs'

type ShikiCodePreviewProps = {
  code: string
  fileName: string
  mimeType: string
}

type CodeLanguage =
  | 'bash'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'css'
  | 'csv'
  | 'html'
  | 'java'
  | 'javascript'
  | 'json'
  | 'jsonc'
  | 'jsx'
  | 'less'
  | 'markdown'
  | 'php'
  | 'python'
  | 'r'
  | 'sass'
  | 'scss'
  | 'shellscript'
  | 'sql'
  | 'tsx'
  | 'typescript'
  | 'vue'
  | 'xml'
  | 'yaml'
  | 'zsh'

const EXTENSION_LANGUAGE: Record<string, CodeLanguage> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'csv',
  cts: 'typescript',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  jsx: 'jsx',
  less: 'less',
  log: 'shellscript',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  php: 'php',
  py: 'python',
  r: 'r',
  sass: 'sass',
  scss: 'scss',
  sh: 'shellscript',
  sql: 'sql',
  svg: 'xml',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'shellscript',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'zsh',
}

const LANGUAGE_REGISTRATIONS: Record<CodeLanguage, LanguageInput[]> = {
  bash: langBash,
  c: langC,
  cpp: langCpp,
  csharp: langCsharp,
  css: langCss,
  csv: langCsv,
  html: langHtml,
  java: langJava,
  javascript: langJavascript,
  json: langJson,
  jsonc: langJsonc,
  jsx: langJsx,
  less: langLess,
  markdown: langMarkdown,
  php: langPhp,
  python: langPython,
  r: langR,
  sass: langSass,
  scss: langScss,
  shellscript: langShellscript,
  sql: langSql,
  tsx: langTsx,
  typescript: langTypescript,
  vue: langVue,
  xml: langXml,
  yaml: langYaml,
  zsh: langZsh,
}

let highlighterPromise: Promise<HighlighterCore> | null = null

function getHighlighter() {
  highlighterPromise ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    langs: Object.values(LANGUAGE_REGISTRATIONS).flat(),
    themes: [githubDarkDimmed as ThemeInput],
  })
  return highlighterPromise
}

function getExtension(fileName: string) {
  const normalized = fileName.toLowerCase()
  const index = normalized.lastIndexOf('.')
  return index >= 0 ? normalized.slice(index + 1) : ''
}

function detectLanguage(fileName: string, mimeType: string): CodeLanguage {
  const extension = getExtension(fileName)
  if (extension && EXTENSION_LANGUAGE[extension]) return EXTENSION_LANGUAGE[extension]
  if (mimeType.includes('json')) return 'json'
  if (mimeType.includes('javascript')) return 'javascript'
  if (mimeType.includes('typescript')) return 'typescript'
  if (mimeType.includes('html')) return 'html'
  if (mimeType.includes('css')) return 'css'
  if (mimeType.includes('xml')) return 'xml'
  if (mimeType.includes('yaml')) return 'yaml'
  if (mimeType.includes('x-python')) return 'python'
  return 'shellscript'
}

export function ShikiCodePreview({ code, fileName, mimeType }: ShikiCodePreviewProps) {
  const language = useMemo(() => detectLanguage(fileName, mimeType), [fileName, mimeType])
  const [html, setHtml] = useState('')

  useEffect(() => {
    let cancelled = false

    void getHighlighter()
      .then(highlighter => highlighter.codeToHtml(code, {
        lang: language as CodeLanguage | SpecialLanguage,
        theme: 'github-dark-dimmed',
        tabindex: false,
      }))
      .then(nextHtml => {
        if (!cancelled) setHtml(nextHtml)
      })
      .catch(() => {
        if (!cancelled) setHtml('')
      })

    return () => {
      cancelled = true
    }
  }, [code, language])

  if (!html) {
    return <pre className="agent-shiki-fallback">{code}</pre>
  }

  return (
    <div
      className="agent-shiki-code"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
