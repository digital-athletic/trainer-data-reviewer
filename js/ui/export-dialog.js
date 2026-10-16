// Export dialog: downloads the changed data files and changelog.md.
import * as model from '../core/model.js';
import * as changelog from '../core/changelog.js';
import { Dialog, download, h, messageDialog, notice, sleep, toast } from './dom.js';
import { t } from './i18n.js';

const p = (text) => h('p', null, text);
const fileCount = (n) => t('count.file', { count: n });

/**
 * Opens the export dialog, or a message when nothing changed.
 * @param {import('./registry.js').Ctx} ctx
 * @param {{ workUnsaved: boolean, saveWork: () => void, onExported: () => void }} opts
 *   onExported runs once, after the last file of this dialog downloads.
 */
export function openExport(ctx, { workUnsaved, saveWork, onExported }) {
  const files = model.changedFiles(ctx.ds);
  if (!files.length) {
    messageDialog({
      title: t('exp.noneTitle'),
      body: [
        p(t('exp.noneBody')),
        workUnsaved ? p(t('exp.noneUnsaved', { work: t('header.workFile'), save: t('header.workSave') })) : null
      ]
    });
    return;
  }

  // The dialog is modal and blocks undo, so the net changes stay the same while it is open.
  const changes = ctx.editor.netChanges();
  const done = new Set();
  // Marks the export once, when the last missing file of this dialog is downloaded.
  let complete = false;
  const downloadOne = (f, li) => {
    download(f.fileName, f.text, 'application/json');
    li.classList.add('is-done');
    done.add(f.path);
    if (complete || done.size < files.length) return;
    complete = true;
    ctx.editor.markExported();
    onExported();
  };
  const rows = files.map((f) => {
    const li = h('li', null,
      h('div', { class: 'file-list__names' },
        h('strong', null, t('exp.saveAs'), h('code', null, f.fileName)),
        h('span', { class: 'file-list__path' }, t('exp.goesTo'), h('code', null, f.repoPath))),
      h('button', { type: 'button', class: 'btn btn--small', onclick: () => downloadOne(f, li) }, t('exp.download')));
    return li;
  });

  const allBtn = h('button', {
    type: 'button', class: 'btn btn--primary',
    onclick: async () => {
      allBtn.disabled = true;
      for (const [i, f] of files.entries()) {
        allBtn.textContent = t('exp.downloading', { i: i + 1, n: files.length });
        downloadOne(f, rows[i]);
        await sleep(300);
      }
      allBtn.disabled = false;
      allBtn.textContent = t('exp.again');
      toast(t('exp.allDone'));
    }
  }, files.length === 1 ? t('exp.one') : t('exp.all', { files: fileCount(files.length) }));

  const logBtn = h('button', {
    type: 'button', class: 'btn',
    onclick: () => download('changelog.md', changelog.build(ctx.editor, ctx.ds, { changes }), 'text/markdown')
  }, t('exp.changelog'));

  // The notes stay in English: changelog.md goes to the developer.
  const notes = changelog.pinnedTestNotes(ctx.editor, ctx.ds, changes);
  new Dialog({
    title: t('exp.title'),
    wide: true,
    body: [
      p(t('exp.summary', { changes: t('count.change', { count: ctx.editor.changeCount(changes) }), files: fileCount(files.length) })),
      h('ul', { class: 'file-list' }, rows),
      h('div', { class: 'row' }, allBtn, logBtn,
        workUnsaved ? h('button', { type: 'button', class: 'btn', onclick: saveWork }, t('header.workSave')) : null),
      h('p', { class: 'small muted' }, t('exp.chrome')),
      notes?.length ? notice('warning', t('exp.notes'), h('ul', { lang: 'en' }, notes.map((n) => h('li', null, n)))) : null,
      notice('info', t('exp.next'), h('ol', null,
        h('li', null, t('exp.next1')),
        h('li', null, t('exp.next2a'), h('code', null, 'Exercises (1).json'), t('exp.next2b'), h('code', null, 'Exercises.json'), t('exp.next2c')),
        h('li', null, t('exp.next3')),
        h('li', null, t('exp.next4'))))
    ],
    actions: [{ label: t('common.close'), value: true, autofocus: true }]
  });
}
