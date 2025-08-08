<script setup lang="ts">
import { Pause, Settings, X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import useAIConfigStore from '@/stores/AIConfig'

/* -------------------- props / emits -------------------- */
const props = defineProps<{
  position: { top: number, left: number }
  selectedText: string
  isDragging: boolean
  isMobile: boolean
}>()
const emit = defineEmits([`closeBtn`, `recalcPos`, `startDrag`])

/* -------------------- reactive state -------------------- */
const configVisible = ref(false)
const visible = ref(false)
const message = ref(``)
const loading = ref(false)
const abortController = ref<AbortController | null>(null)
const customPrompts = ref<string[]>([])
const hasResult = ref(false)
const formatValidationPassed = ref(true)
const selectedAction = ref<
  `markdown-format` | `optimize` | `summarize` | `spellcheck` | `translate-zh` | `translate-en` | `custom`
>(`optimize`)
const currentText = ref(``)
const error = ref(``)

/* -------------------- store & refs -------------------- */
const store = useStore()
const resultContainer = ref<HTMLElement | null>(null)

/* -------------------- AI config -------------------- */
const AIConfigStore = useAIConfigStore()
const { apiKey, endpoint, model, temperature, maxToken, type }
  = storeToRefs(AIConfigStore)

/* -------------------- action options -------------------- */
interface ActionOption {
  value: string
  label: string
  defaultPrompt: string
}

const actionOptions: ActionOption[] = [
  {
    value: `markdown-format`,
    label: `格式优化（仅加 Markdown 语法）`,
    defaultPrompt:
      `请仅为下列纯文本添加必要的 Markdown 语法标记，使其结构化渲染（如标题层级、列表、引用、代码块、分隔线、链接、表格）。严格禁止修改原文任意字符（不可增删改、不可纠错、不可翻译），仅可插入 Markdown 标记与必要的换行/空行。`,
  },
  {
    value: `optimize`,
    label: `优化文本`,
    defaultPrompt: `请优化文本，使其更通顺易读。`,
  },
  {
    value: `summarize`,
    label: `文章总结`,
    defaultPrompt: `请对文本进行摘要，输出主要观点和结论。`,
  },
  {
    value: `spellcheck`,
    label: `错别字纠正`,
    defaultPrompt: `请找出并纠正文本中的错别字、标点和语法错误。`,
  },
  {
    value: `translate-zh`,
    label: `翻译为中文`,
    defaultPrompt: `请将文本翻译为地道的中文。`,
  },
  {
    value: `translate-en`,
    label: `翻译为英文`,
    defaultPrompt: `请将文本翻译为自然流畅的英文。`,
  },
  { value: `custom`, label: `自定义`, defaultPrompt: `` },
]

/* -------------------- watchers -------------------- */
watch(message, async () => {
  emit(`recalcPos`)
  await nextTick()
  resultContainer.value?.scrollTo({ top: resultContainer.value.scrollHeight })
})

watch(selectedAction, (val) => {
  if (val !== `custom`)
    customPrompts.value = []
})

// 当 visible 且 props.selectedText 变更时，更新原文并重置状态
watch(
  () => props.selectedText,
  (val) => {
    if (visible.value) {
      currentText.value = val
      resetState()
    }
  },
)

/* -------------------- prompt handlers -------------------- */
function addPrompt(e: KeyboardEvent) {
  const input = e.target as HTMLInputElement
  const prompt = input.value.trim()
  if (prompt && !customPrompts.value.includes(prompt)) {
    customPrompts.value.push(prompt)
  }
  input.value = ``
  emit(`recalcPos`)
}

function removePrompt(index: number) {
  customPrompts.value.splice(index, 1)
}

function resetState() {
  message.value = ``
  loading.value = false
  hasResult.value = false
  error.value = ``

  abortController.value?.abort()
  abortController.value = null
}

/* -------------------- AI call -------------------- */
async function runAIAction() {
  const text = currentText.value.trim()
  if (!text || loading.value)
    return

  resetState()
  loading.value = true
  abortController.value = new AbortController()
  formatValidationPassed.value = true

  let systemPrompt
    = `你是一名专业的多语言文本助手，请根据用户的指令处理下列内容。在输出时，不要输出任何额外的信息，只输出处理后的文本。`
  if (selectedAction.value === `markdown-format`) {
    systemPrompt
      = `你是一名严格的 Markdown 标注助手。务必遵守：1）只能插入 Markdown 语法标记（如 #、##、###、-、*、1.、>、\`、\`\`\` 等）与必要的换行/空行；2）严禁改动原文任一字符（包括文字、数字、标点和其顺序），也不得删除或重排；3）不得润色、纠错、精简或翻译；4）应智能识别题目/小标题与大纲层级、列表（有序/无序）、引用、代码块、分隔线、表格、以及将裸露 URL 转为符合 Markdown 的链接（仅添加语法，不改动 URL 文本）；5）输出只包含添加标记后的 Markdown 文本。`
  }
  const picked = actionOptions.find(o => o.value === selectedAction.value)!
  const parts: string[] = []

  if (picked.defaultPrompt)
    parts.push(picked.defaultPrompt)
  if (customPrompts.value.length)
    parts.push(`请同时满足以下要求：${customPrompts.value.join(`、`)}。`)
  if (!parts.length)
    parts.push(`请根据最佳实践优化文本。`)

  const userCommand = parts.join(` `)
  const messages = [
    { role: `system`, content: systemPrompt },
    { role: `user`, content: `${userCommand}\n\n待处理文本：\n${text}` },
  ]

  const payload = {
    model: model.value,
    messages,
    temperature: temperature.value,
    max_tokens: maxToken.value,
    stream: true,
  }

  const headers: Record<string, string> = {
    'Content-Type': `application/json`,
  }
  if (apiKey.value && type.value !== `default`) {
    headers.Authorization = `Bearer ${apiKey.value}`
  }

  try {
    const url = new URL(endpoint.value)
    if (!url.pathname.endsWith(`/chat/completions`)) {
      url.pathname = url.pathname.replace(/\/?$/, `/chat/completions`)
    }

    const res = await window.fetch(url.toString(), {
      method: `POST`,
      headers,
      body: JSON.stringify(payload),
      signal: abortController.value!.signal,
    })

    if (!res.ok || !res.body)
      throw new Error(`响应错误：${res.status}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder(`utf-8`)
    let buffer = ``

    while (true) {
      const { value, done } = await reader.read()
      if (done)
        break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(`\n`)
      buffer = lines.pop() || ``

      for (const line of lines) {
        if (!line.trim() || line.trim() === `data: [DONE]`)
          continue
        try {
          const json = JSON.parse(line.replace(/^data: /, ``))
          const delta = json.choices?.[0]?.delta?.content
          if (delta?.trim()) {
            message.value += delta
            hasResult.value = true
          }
        }
        catch {}
      }
    }

    // After stream finished: validate for markdown-format
    if (selectedAction.value === `markdown-format`) {
      const original = currentText.value
      const formatted = message.value
      formatValidationPassed.value = validateMarkdownOnlyInsertion(original, formatted)
      if (!formatValidationPassed.value) {
        error.value = `检测到输出可能改动了原文字符或顺序，已拦截。请重试或调整提示词。`
      }
    }
  }
  catch (e: any) {
    if (e.name === `AbortError`) {
      console.log(`Request aborted by user.`)
    }
    else {
      console.error(`请求失败：`, e)
      error.value = e.message || `请求失败`
    }
  }
  finally {
    loading.value = false
  }
}

/* -------------------- abort handler -------------------- */
function stopAI() {
  if (loading.value && abortController.value) {
    abortController.value.abort()
    loading.value = false
  }
}

/* -------------------- actions -------------------- */
function replaceText() {
  if (selectedAction.value === `markdown-format` && !formatValidationPassed.value) {
    toast.error(`结果未通过校验，已阻止替换。`)
    return
  }
  const cm = toRaw(store.editor!)!
  const start = cm.getCursor(`start`)
  cm.replaceSelection(message.value)
  const end = cm.getCursor(`end`)
  cm.setSelection(start, end)
  cm.focus()

  currentText.value = message.value
  resetState()
}

function show() {
  emit(`closeBtn`)
  if (!props.selectedText.trim()) {
    toast.error(`请选择需要处理的内容`)
    return
  }
  visible.value = true
  currentText.value = props.selectedText
  emit(`recalcPos`)
}

function close() {
  visible.value = false
  customPrompts.value = []
  selectedAction.value = `optimize`
  resetState()
}

defineExpose({ visible, runAIAction, replaceText, show, close, stopAI })

// -------------------- helpers: validation --------------------
function validateMarkdownOnlyInsertion(original: string, formatted: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, ` `).trim()
  const stripMd = (md: string) => {
    let out = md
    // Remove code fences (drop the fence lines but keep inner content)
    // Use a simple line-anchored pattern to avoid assertion contradictions
    out = out.replace(/^\s*```[^\n]*$/gm, ``)
    // Remove ATX headings markers at line start
    out = out.replace(/^(\s{0,3}#{1,6})\s+/gm, ``)
    // Remove blockquote markers
    out = out.replace(/^(\s{0,3}>+)\s?/gm, ``)
    // Remove list markers (unordered and ordered)
    out = out.replace(/^(\s{0,3})([-*+])\s+/gm, `$1`)
    out = out.replace(/^(\s{0,3})\d+\.[)\s]+/gm, `$1`)
    // Remove horizontal rules lines
    out = out.replace(/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/gm, ``)
    // Remove table header separators (e.g., | --- | :---: |)
    // Avoid overlapping \s* with classes containing spaces to prevent super-linear backtracking
    out = out.replace(/^[ \t]*(?:\|[ \t]*)?(?:[:\-|][ \t]*)+$/gm, ``)
    // Strip table pipes but keep cell contents
    out = out.replace(/^[ \t]*\|(?:[^|\n]*\|)+[ \t]*$/gm, row => row.replace(/[ \t]*\|[ \t]*/g, ` `).trim())
    // Inline code backticks
    out = out.replace(/`([^`]*)`/g, `$1`)
    // Emphasis markers
    out = out.replace(/\*{1,3}([^*]+)\*{1,3}/g, `$1`).replace(/_{1,3}([^_]+)_{1,3}/g, `$1`)
    // Links: [text](url) -> text ; images ![alt](src) -> alt src? Keep alt text only
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, `$1`)
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `$1`)
    // Autolink <url> -> url
    out = out.replace(/<([^>]+)>/g, `$1`)
    // HTML tags (should not be added, but just in case)
    out = out.replace(/<[^>]+>/g, ``)
    return out
  }
  const a = normalize(original)
  const b = normalize(stripMd(formatted))
  return a === b
}
</script>

<template>
  <Transition name="fade-scale">
    <div
      v-if="visible"
      class="bg-card border-border text-card-foreground fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[90vw] flex flex-col overflow-hidden border rounded-xl shadow-2xl sm:w-[460px] -translate-x-1/2 -translate-y-1/2 sm:translate-x-0 sm:translate-y-0"
      :style="props.isMobile ? {} : { left: `${position.left}px`, top: `${position.top}px`, transformOrigin: 'top left' }"
    >
      <!-- header -->
      <div
        class="border-border popover-header flex select-none items-center justify-between border-b px-4 pb-2 pt-3 sm:cursor-move sm:px-6"
        @mousedown="!props.isMobile && emit('startDrag', $event)"
      >
        <div class="flex items-center gap-2">
          <span class="text-lg font-bold">AI 工具箱</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="配置"
            @click="configVisible = !configVisible"
          >
            <Settings class="h-4 w-4" />
          </Button>
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭" @click="close">
          <X class="h-3 w-3" />
        </Button>
      </div>

      <!-- config panel -->
      <AIConfig
        v-if="configVisible"
        class="border-border mb-4 w-full border rounded-md p-4"
        @saved="() => (configVisible = false)"
      />

      <!-- main content -->
      <section v-else class="custom-scroll space-y-3 flex-1 overflow-y-auto px-4 pb-2 pt-3 sm:px-6">
        <!-- action selector -->
        <div>
          <div class="mb-1 text-sm font-semibold">
            选择操作
          </div>
          <Select v-model="selectedAction">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="请选择要执行的操作" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="opt in actionOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <!-- original text -->
        <div>
          <div class="mb-1 text-sm font-semibold">
            原文
          </div>
          <div
            class="border-border custom-scroll bg-muted/20 text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-line border rounded px-3 py-2 text-sm"
          >
            {{ currentText }}
          </div>
        </div>

        <!-- custom prompts -->
        <div v-if="selectedAction === 'custom'">
          <div class="mb-1 text-sm font-semibold">
            自定义提示词（可选）
          </div>
          <div
            class="custom-scroll border-border max-h-24 min-h-[40px] flex flex-wrap gap-2 overflow-y-auto border rounded px-2 py-1"
          >
            <template v-for="(prompt, index) in customPrompts" :key="index">
              <div
                class="text-muted-foreground bg-muted flex items-center gap-1 rounded-full px-2 py-1 text-sm"
              >
                <span>{{ prompt }}</span>
                <button
                  class="hover:bg-muted/60 h-4 w-4 flex items-center justify-center rounded-full"
                  @click="removePrompt(index)"
                >
                  <X class="h-3 w-3" />
                </button>
              </div>
            </template>
            <input
              class="min-w-[100px] flex-1 bg-transparent py-1 text-sm focus:outline-none"
              placeholder="输入提示词后按回车"
              @keydown.enter="addPrompt"
            >
          </div>
        </div>

        <!-- error -->
        <div v-if="error" class="min-h-[24px] flex items-center text-[12px] text-red-500">
          {{ error }}
        </div>

        <!-- result -->
        <div v-if="message">
          <div class="mb-1 text-sm font-semibold">
            处理结果
          </div>
          <div
            ref="resultContainer"
            class="custom-scroll border-border bg-background max-h-40 min-h-[60px] overflow-y-auto whitespace-pre-line border rounded px-3 py-2 text-sm"
          >
            {{ message }}
          </div>
        </div>

        <!-- footer buttons -->
        <div class="border-border flex justify-end gap-2 border-t px-6 pb-3 pt-2">
          <Button v-if="loading" variant="secondary" @click="stopAI">
            <Pause class="mr-1 h-4 w-4" /> 终止
          </Button>
          <Button
            v-if="hasResult && !loading"
            variant="default"
            @click="replaceText"
          >
            接受
          </Button>
          <Button
            v-if="!loading"
            variant="outline"
            :disabled="!hasResult && !!message"
            @click="runAIAction"
          >
            {{ hasResult ? '重试' : 'AI 处理' }}
          </Button>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.fade-scale-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.fade-scale-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  --tw-scale-x: 0.95;
  --tw-scale-y: 0.95;
}
.fade-scale-enter-to,
.fade-scale-leave-from {
  opacity: 1;
  --tw-scale-x: 1;
  --tw-scale-y: 1;
}

.custom-scroll::-webkit-scrollbar {
  width: 6px;
}
.custom-scroll::-webkit-scrollbar-thumb {
  /* Tailwind @apply in <style> needs explicit classes when using <style scoped> */
  background-color: rgba(156, 163, 175, 0.4);
  border-radius: 9999px;
}
.custom-scroll::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.6);
}
.custom-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(156, 163, 175, 0.4) transparent;
}
:deep(.dark) .custom-scroll {
  scrollbar-color: rgba(107, 114, 128, 0.4) transparent;
}

.popover-header {
  cursor: move;
  user-select: none;
}

@media (pointer: coarse) {
  .custom-scroll::-webkit-scrollbar {
    width: 3px;
  }
}
</style>
