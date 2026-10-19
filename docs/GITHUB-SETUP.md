# The GitHub repository

The project is on GitHub at **https://github.com/adhyanmavuri-tech/auto-step-climb** (public, Issues on), and this
folder is that repository. It holds the source code (MIT, see `LICENSE`) and the page people report bugs on: a bug
report form that asks for the text **Copy report** puts on the clipboard, a feature request form, and a setting that
turns off blank issues so every report has the same details (all in `.github\ISSUE_TEMPLATE`). The window's
**Report a problem** button opens the issue chooser (`ISSUES_URL` in `src\support.ts`).

The repository began on 2026-10-17 as the bug report page only. The source code was added on 2026-10-19, on top of
that history. The page's files were kept at first in `docs\github-repo`, a separate git repository with the same
`origin`. That old copy is no longer used: it is in `.gitignore`, and you can delete the folder.

## Changing the code, the forms or the readme

In PowerShell, in the project folder:

```
git status
git add .
git commit -m "What you changed"
git push
```

Read `git status` before you add. `.gitignore` keeps out what must not go public: `config.json` (it holds your
SimBrief name), `discovery.json`, `logs\`, the build output (`release\`, `out\`, `bin\`), `node_modules\`, the retired
experiments in `retired\` and the old `docs\github-repo`. Keep real names out of the tests too: they use made-up ones
(`examplepilot`, `Jane Pilotson`).

After changing a form, open the repository's **Issues, New issue** page and look: a form GitHub cannot read is left
out or shown with an error. The form files are YAML, which is fussy about indentation and about options that look
like yes/no/true/false.

## When the flightsim.to page exists

- In `README.md`, add the download link under the first paragraph. In `.github\ISSUE_TEMPLATE\config.yml`,
  uncomment the contact link, so people with a question (not a bug) have somewhere to go.
- Commit and push as above.

## Things to know

- The repository is public, under your account name. Its commits carry the name and e-mail of your git identity
  (Adhyan Mavuri, the same as RoutePilot's commits) and credit Claude as a co-author, which is why Claude shows under
  Contributors.
- **Watch** on the repository page is set to All activity, so GitHub notifies you of every new issue and comment
  (where you see it depends on your GitHub notification settings). If that is too much, change it on the page:
  Custom, Issues keeps it to new issues.
- Anyone with a GitHub account can open an issue. Closing, locking or deleting one is up to you.
- To turn the **Report a problem** button off, set `ISSUES_URL` in `src\support.ts` to `''` and rebuild. The app
  still has **Copy report**.
