import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface QuickCommandPersisted {
  id: string
  label: string
  template: string // 用 {{sel}} 占位
}

export interface QuickCommandRuntime extends QuickCommandPersisted {
  buildPrompt: (sel?: string) => string
}

const STORAGE_KEY = `quick_commands`

// 把持久化的对象转换为可执行的 buildPrompt
function hydrate(cmd: QuickCommandPersisted): QuickCommandRuntime {
  return {
    ...cmd,
    buildPrompt: (sel = ``) =>
      cmd.template.replace(/\{\{\s*sel\s*\}\}/gi, sel),
  }
}

// 4 条默认指令
const DEFAULT_COMMANDS: QuickCommandPersisted[] = [
  {
    id: `md-format`,
    label: `格式优化（仅加 Markdown 语法）`,
    template:
      `请识别下列纯文本的题目或者章节与标题，添加必要的 Markdown 语法标记，使其结构化渲染（如标题层级、列表、引用、代码块、分隔线、链接、表格）。严格禁止修改原文任意字符（不可增删改、不可纠错、不可翻译），仅可插入 Markdown 标记与必要的换行/空行。\n\n{{sel}}`,
  },
  { id: `polish`, label: `润色`, template: `请润色以下内容：\n\n{{sel}}` },
  { id: `to-en`, label: `翻译成英文`, template: `请将以下内容翻译为英文：\n\n{{sel}}` },
  { id: `to-zh`, label: `翻译成中文`, template: `Please translate the following content into Chinese:\n\n{{sel}}` },
  { id: `summary`, label: `总结`, template: `请对以下内容进行总结：\n\n{{sel}}` },
]

export const useQuickCommands = defineStore(`quickCommands`, () => {
  // ---------- state ----------
  const commands = ref<QuickCommandRuntime[]>([])

  // ---------- helpers ----------
  function save() {
    const toSave: QuickCommandPersisted[] = commands.value.map(
      ({ id, label, template }) => ({ id, label, template }),
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const parsed: QuickCommandPersisted[] = JSON.parse(raw)
        commands.value = parsed.map(hydrate)
      }
      catch (e) {
        console.warn(`解析快捷指令失败，已恢复默认值`, e)
        commands.value = DEFAULT_COMMANDS.map(hydrate)
        save()
      }
    }
    else {
      commands.value = DEFAULT_COMMANDS.map(hydrate)
      save()
    }
  }

  // ---------- CRUD ----------
  function add(label: string, template: string) {
    const id = crypto.randomUUID()
    commands.value.push(hydrate({ id, label, template }))
  }

  function update(id: string, label: string, template: string) {
    const idx = commands.value.findIndex(c => c.id === id)
    if (idx !== -1)
      commands.value[idx] = hydrate({ id, label, template })
  }

  function remove(id: string) {
    commands.value = commands.value.filter(c => c.id !== id)
  }

  // ---------- init ----------
  load()
  watch(commands, save, { deep: true })

  return { commands, add, update, remove }
})
