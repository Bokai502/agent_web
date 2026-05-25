export interface AskUserPayload {
  question: string
  options: string[]
}

export const ASK_USER_PROTOCOL = [
  "You can ask the user for one missing piece of information through the application's ask-user-question capability.",
  "Use it only when a required detail is missing and you cannot proceed safely or accurately without it.",
  "When you need that capability, respond with exactly this XML block and nothing else:",
  "<ask-user-question>",
  "<question>your concise question here</question>",
  "<option>first short option</option>",
  "<option>second short option</option>",
  "<option>third short option</option>",
  "</ask-user-question>",
  "Rules:",
  "- Ask exactly one concise question.",
  "- Include 2 or 3 short, mutually exclusive <option> entries whenever possible.",
  "- Do not include an \"Other\" option. The UI will provide a free-text Other field automatically.",
  "- Do not add explanations, markdown fences, or any other text outside the XML block.",
  "- Do not guess the missing detail if it is necessary.",
].join("\n")

export const ASK_USER_TAG_START = /^\s*<ask-user-question>/i

const ASK_USER_BLOCK_RE = /^\s*<ask-user-question>\s*([\s\S]*?)\s*<\/ask-user-question>\s*$/i
const ASK_USER_QUESTION_RE = /<question>\s*([\s\S]*?)\s*<\/question>/i
const ASK_USER_OPTION_RE = /<option>\s*([\s\S]*?)\s*<\/option>/gi

function normalizeXmlText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function extractAskUserPayload(text: string): AskUserPayload | null {
  const match = text.match(ASK_USER_BLOCK_RE)
  if (!match) return null
  const body = match[1]
  const questionMatch = body.match(ASK_USER_QUESTION_RE)
  const question = questionMatch
    ? normalizeXmlText(questionMatch[1])
    : normalizeXmlText(body.replace(/<[^>]+>/g, " "))

  if (!question) return null

  const options = Array.from(body.matchAll(ASK_USER_OPTION_RE))
    .map(optionMatch => normalizeXmlText(optionMatch[1]))
    .filter(Boolean)
    .filter((option, index, all) => all.indexOf(option) === index)
    .slice(0, 3)

  return { question, options }
}
