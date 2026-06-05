import { ref, watchEffect } from 'vue'

type Theme = 'light' | 'dark'
const theme = ref<Theme>((localStorage.getItem('theme') as Theme) || 'light')

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem('theme', t)
}
applyTheme(theme.value)
watchEffect(() => applyTheme(theme.value))

export function useTheme() {
  function toggle() { theme.value = theme.value === 'light' ? 'dark' : 'light' }
  return { theme, toggle }
}
