import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

const IMAGE_PATH_RE = /([A-Za-z]:[/\\][\w/\\. -]+\.(?:png|jpg|jpeg|gif|webp|svg))/g

type Tone = "primary" | "muted"

type MarkdownTextProps = {
  imageSrcResolver?: (src: string) => string
  text: string
  tone?: Tone
}

function toMarkdownWithLocalImages(text: string) {
  return text.replace(IMAGE_PATH_RE, (path) => {
    const src = `/api/image?path=${encodeURIComponent(path)}`
    return `\n\n![${path}](${src})\n\n`
  })
}

export function MarkdownText({ imageSrcResolver, text, tone = "primary" }: MarkdownTextProps) {
  const color = tone === "muted" ? "var(--text-2)" : "var(--text)"
  const inlineCodeBg = tone === "muted" ? "rgba(15, 23, 42, 0.05)" : "rgba(15, 23, 42, 0.08)"
  const codeBg = tone === "muted" ? "rgba(15, 23, 42, 0.04)" : "var(--code-bg)"
  const border = "var(--border)"

  return (
    <div
      style={{
        color,
        wordBreak: "break-word",
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 12px", lineHeight: 1.78 }}>{children}</p>,
          h1: ({ children }) => <h1 style={{ margin: "0 0 12px", fontSize: 26, lineHeight: 1.3 }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ margin: "18px 0 10px", fontSize: 22, lineHeight: 1.35 }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ margin: "16px 0 8px", fontSize: 18, lineHeight: 1.4 }}>{children}</h3>,
          ul: ({ children }) => <ul style={{ margin: "0 0 12px", paddingLeft: 22 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: "0 0 12px", paddingLeft: 22 }}>{children}</ol>,
          li: ({ children }) => <li style={{ margin: "4px 0", lineHeight: 1.7 }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: "0 0 12px",
                padding: "0 0 0 12px",
                borderLeft: `3px solid ${border}`,
                opacity: 0.92,
              }}
            >
              {children}
            </blockquote>
          ),
          code: ({ className, children, ...props }) => {
            const inline = !className
            return inline ? (
              <code
                {...props}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "0.92em",
                  padding: "2px 5px",
                  borderRadius: 6,
                  background: inlineCodeBg,
                }}
              >
                {children}
              </code>
            ) : (
              <code
                {...props}
                className={className}
                style={{ fontFamily: "var(--mono)", fontSize: 12.5, lineHeight: 1.65 }}
              >
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre
              style={{
                margin: "0 0 12px",
                padding: "12px 14px",
                borderRadius: 8,
                overflowX: "auto",
                background: codeBg,
                border: `1px solid ${border}`,
              }}
            >
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: "auto", margin: "0 0 12px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${border}` }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{ padding: "8px 10px", borderBottom: `1px solid ${border}` }}>{children}</td>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--blue)" }}>
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <span style={{ display: "block", margin: "10px 0" }}>
              <img src={src ? imageSrcResolver?.(src) ?? src : ""} alt={alt ?? ""} style={{ maxWidth: "100%", borderRadius: 6, display: "block" }} />
              {alt ? (
                <span
                  style={{
                    display: "block",
                    marginTop: 4,
                    fontSize: 11,
                    color: "var(--text-3)",
                    fontFamily: "var(--mono)",
                    wordBreak: "break-all",
                  }}
                >
                  {alt}
                </span>
              ) : null}
            </span>
          ),
        }}
      >
        {toMarkdownWithLocalImages(text)}
      </ReactMarkdown>
    </div>
  )
}
