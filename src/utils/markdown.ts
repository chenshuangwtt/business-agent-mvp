const PREFACE_RE =
  /^(好的|明白|收到|当然|遵照|根据您的|以下是|下面是|为您生成|我将|已为您)/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

export function cleanMarkdownOutput(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const cleaned: string[] = [];
  let atStart = true;

  for (const line of lines) {
    const trimmed = line.trim();

    if (atStart) {
      if (!trimmed) continue;
      if (PREFACE_RE.test(trimmed)) continue;
    }

    atStart = false;
    if (HR_RE.test(trimmed)) continue;
    cleaned.push(line);
  }

  return cleaned.join("\n").trim();
}
