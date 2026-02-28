import ejs from "ejs";

export function renderTemplateString(template: string, variables: Record<string, string>): string {
  return ejs.render(template, variables, {
    async: false
  });
}
