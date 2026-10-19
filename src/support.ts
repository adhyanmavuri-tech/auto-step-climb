/**
 * Where people report problems: the address of the project's GitHub issue page. The window has a "Report a problem"
 * button that opens it. Set ISSUES_URL to '' and there is no such button; "Copy report" works either way.
 *
 * Only an https://github.com/ address is ever opened, whatever is put here.
 */
export const ISSUES_URL = 'https://github.com/adhyanmavuri-tech/auto-step-climb/issues/new/choose'

/** The page to open for a bug report, or '' when none is set (or the setting is not a GitHub address). */
export function issuesUrl(url: string = ISSUES_URL): string {
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/[\w./?=&%-]*)?$/.test(url) ? url : ''
}
